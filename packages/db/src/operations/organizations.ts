/**
 * Organizadores bajo IMPACTA y la revisión de sus eventos.
 *
 * Cada organizador es una organización propia: sus eventos, recintos, ventas, puerta y
 * cuentas cuelgan de ella, así que nunca ve lo de otro. Solo IMPACTA (la organización
 * isPlatform) crea organizadores y sus cuentas, y aprueba sus eventos antes de publicarlos.
 */
import { DEFAULT_CURRENCY, slugify } from "@ticketera/core";
import { prisma } from "../client";
import type { OrganizationStatus } from "../generated/prisma/client";
import { hashPassword } from "./accounts";
import { DomainError, audit, isUniqueViolation } from "./shared";

async function uniqueOrganizationSlug(name: string) {
  const base = slugify(name) || "organizador";
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await prisma.organization.findUnique({ where: { slug } }))) return slug;
  }
}

/**
 * Da de alta un organizador con su cuenta de administrador. Empieza vacío: sin eventos,
 * recintos ni ventas. La contraseña es temporal: la tiene que cambiar al entrar.
 */
export async function createOrganizer(input: {
  name: string;
  taxId?: string;
  contactEmail?: string;
  admin: { name: string; email: string; password: string };
  actorId: string;
}) {
  const slug = await uniqueOrganizationSlug(input.name);
  try {
    return await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.name.trim(),
          slug,
          currency: DEFAULT_CURRENCY,
          taxId: input.taxId?.trim() || null,
          contactEmail: input.contactEmail?.trim().toLowerCase() || null,
        },
      });
      const admin = await tx.staffUser.create({
        data: {
          name: input.admin.name.trim(),
          email: input.admin.email.trim().toLowerCase(),
          passwordHash: await hashPassword(input.admin.password),
          mustChangePassword: true,
          memberships: { create: { organizationId: organization.id, role: "ADMIN" } },
        },
      });
      await audit(tx, {
        actorType: "staff",
        actorId: input.actorId,
        action: "organizer.create",
        entity: "Organization",
        entityId: organization.id,
        data: { adminId: admin.id },
      });
      return { organization, admin };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("DUPLICATE", "Ya existe una cuenta con ese email.");
    throw error;
  }
}

/** Suspender corta el acceso de sus cuentas y saca sus eventos de la web. La plataforma no se suspende. */
export async function setOrganizationStatus(organizationId: string, status: OrganizationStatus, actorId: string) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw new DomainError("NOT_FOUND", "Organizador no encontrado.");
  if (organization.isPlatform) throw new DomainError("INVALID_STATE", "La plataforma no se puede suspender.");
  await prisma.organization.update({ where: { id: organizationId }, data: { status } });
  await audit(prisma, {
    actorType: "staff",
    actorId,
    action: status === "SUSPENDED" ? "organizer.suspend" : "organizer.activate",
    entity: "Organization",
    entityId: organizationId,
  });
}

/** Qué le falta a un evento para salir a la venta, o null si está listo. */
export async function publicationProblem(eventId: string): Promise<string | null> {
  const sessions = await prisma.eventSession.findMany({
    where: { eventId, cancelledAt: null },
    select: { _count: { select: { ticketTypes: true } } },
  });
  if (sessions.length === 0) return "Agrega al menos una función antes de publicar.";
  if (sessions.some((s) => s._count.ticketTypes === 0)) {
    return "Todas las funciones necesitan al menos un tipo de entrada antes de publicar.";
  }
  return null;
}

/** El organizador lo deja listo y lo envía: IMPACTA lo revisa antes de que salga en la web. */
export async function submitEventForReview(eventId: string, actorId: string, now = new Date()) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new DomainError("NOT_FOUND", "Evento no encontrado.");
  if (event.status !== "DRAFT") throw new DomainError("INVALID_STATE", "Solo se envía a revisión un evento en borrador.");
  const problem = await publicationProblem(eventId);
  if (problem) throw new DomainError("INVALID_STATE", problem);
  await prisma.event.update({
    where: { id: eventId },
    data: { status: "PENDING_REVIEW", submittedAt: now, reviewNote: null },
  });
  await audit(prisma, { actorType: "staff", actorId, action: "event.submit", entity: "Event", entityId: eventId });
}

/** IMPACTA aprueba: el evento sale en la web y queda a la venta. */
export async function approveEvent(eventId: string, actorId: string, now = new Date()) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new DomainError("NOT_FOUND", "Evento no encontrado.");
  if (event.status !== "PENDING_REVIEW") throw new DomainError("INVALID_STATE", "Este evento no está esperando revisión.");
  const problem = await publicationProblem(eventId);
  if (problem) throw new DomainError("INVALID_STATE", problem);
  await prisma.event.update({ where: { id: eventId }, data: { status: "PUBLISHED", publishedAt: now, reviewNote: null } });
  await audit(prisma, { actorType: "staff", actorId, action: "event.approve", entity: "Event", entityId: eventId });
}

/** IMPACTA lo devuelve con lo que hay que corregir; el organizador lo vuelve a enviar. */
export async function rejectEvent(eventId: string, note: string, actorId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new DomainError("NOT_FOUND", "Evento no encontrado.");
  if (event.status !== "PENDING_REVIEW") throw new DomainError("INVALID_STATE", "Este evento no está esperando revisión.");
  const reviewNote = note.trim();
  if (reviewNote.length < 3) throw new DomainError("INVALID_STATE", "Escribe qué hay que corregir.");
  await prisma.event.update({ where: { id: eventId }, data: { status: "DRAFT", reviewNote } });
  await audit(prisma, {
    actorType: "staff",
    actorId,
    action: "event.reject",
    entity: "Event",
    entityId: eventId,
    data: { note: reviewNote },
  });
}
