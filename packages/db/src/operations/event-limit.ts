/**
 * Límite de eventos activos por organizador.
 *
 * Cuenta los eventos en borrador, en revisión y publicados que no pasaron (no cuenta los cancelados ni los
 * que ya se realizaron: todas sus funciones quedaron atrás). Lo fija IMPACTA por organizador; vacío = sin
 * límite, y la plataforma misma nunca tiene límite. Solo frena CREAR eventos: los que ya existen siguen
 * funcionando aunque se baje el límite por debajo de lo que ya hay.
 */
import { prisma } from "../client";
import { Prisma } from "../generated/prisma/client";
import { DomainError, audit } from "./shared";

/** Eventos que cuentan para el límite. */
export function activeEventWhere(organizationId: string, now = new Date()): Prisma.EventWhereInput {
  return {
    organizationId,
    status: { in: ["DRAFT", "PENDING_REVIEW", "PUBLISHED"] },
    // Sin funciones todavía (recién creado) o con alguna función por venir.
    OR: [{ sessions: { none: {} } }, { sessions: { some: { startsAt: { gte: now } } } }],
  };
}

export type EventQuota = {
  /** Máximo permitido; null = sin límite. */
  limit: number | null;
  used: number;
  /** Cuántos más puede crear; null = sin límite. */
  remaining: number | null;
  reached: boolean;
};

export async function getEventQuota(organizationId: string, now = new Date()): Promise<EventQuota> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { maxActiveEvents: true, isPlatform: true },
  });
  const used = await prisma.event.count({ where: activeEventWhere(organizationId, now) });
  const limit = organization && !organization.isPlatform ? organization.maxActiveEvents : null;
  const remaining = limit === null ? null : Math.max(0, limit - used);
  return { limit, used, remaining, reached: limit !== null && used >= limit };
}

export const eventLimitMessage = (limit: number) =>
  `Llegaste al límite de ${limit} evento${limit === 1 ? "" : "s"} activo${limit === 1 ? "" : "s"}. Para crear otro, cancela o elimina uno que ya no uses, o pide a IMPACTA ampliar tu límite.`;

/**
 * Crea un evento respetando el límite (salvo `ignoreLimit`: IMPACTA trabajando dentro de un organizador). La
 * comprobación y la creación van juntas bajo un bloqueo de la organización: dos creaciones a la vez no pueden
 * pasarse del límite.
 */
export async function createEventWithinLimit(data: Prisma.EventUncheckedCreateInput, options: { now?: Date; ignoreLimit?: boolean } = {}) {
  const now = options.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${data.organizationId} FOR UPDATE`;
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: data.organizationId },
      select: { maxActiveEvents: true, isPlatform: true },
    });
    if (!options.ignoreLimit && !organization.isPlatform && organization.maxActiveEvents !== null) {
      const used = await tx.event.count({ where: activeEventWhere(data.organizationId, now) });
      if (used >= organization.maxActiveEvents) throw new DomainError("EVENT_LIMIT", eventLimitMessage(organization.maxActiveEvents));
    }
    return tx.event.create({ data });
  });
}

/** IMPACTA fija el límite de un organizador (null = sin límite). Bajarlo por debajo de lo que ya tiene no borra nada. */
export async function setMaxActiveEvents(organizationId: string, limit: number | null, actorId: string) {
  if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 10_000)) {
    throw new DomainError("INVALID_STATE", "El límite debe ser un número entero de 0 a 10.000, o vacío para no limitar.");
  }
  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw new DomainError("NOT_FOUND", "Organizador no encontrado.");
  if (organization.isPlatform) throw new DomainError("INVALID_STATE", "La plataforma no tiene límite de eventos.");
  await prisma.organization.update({ where: { id: organizationId }, data: { maxActiveEvents: limit } });
  await audit(prisma, {
    actorType: "staff",
    actorId,
    action: "organizer.event_limit",
    entity: "Organization",
    entityId: organizationId,
    data: { before: organization.maxActiveEvents, after: limit },
  });
}
