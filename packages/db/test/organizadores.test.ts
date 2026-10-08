/**
 * Organizadores bajo IMPACTA: alta (empiezan vacíos), revisión de eventos, suspensión y
 * contraseñas temporales, contra PostgreSQL real.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { changeStaffPassword, verifyStaffCredentials } from "../src/operations/accounts";
import { createPendingOrder } from "../src/operations/orders";
import {
  approveEvent,
  createOrganizer,
  rejectEvent,
  setOrganizationStatus,
  submitEventForReview,
} from "../src/operations/organizations";
import { buyer, createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

const PASSWORD = "Temporal2026!";

async function impactaAdmin() {
  return prisma.staffUser.create({
    data: { email: `impacta-${randomCode(6).toLowerCase()}@prueba.test`, name: "Impacta", passwordHash: "!" },
  });
}

async function newOrganizer() {
  const actor = await impactaAdmin();
  const suffix = randomCode(6).toLowerCase();
  return createOrganizer({
    name: `Productora ${suffix}`,
    taxId: "1234567",
    contactEmail: `CONTACTO-${suffix}@prueba.test`,
    admin: { name: "Dueña de la productora", email: `admin-${suffix}@prueba.test`, password: PASSWORD },
    actorId: actor.id,
  });
}

describe("alta de organizadores", () => {
  it("un organizador nuevo empieza vacío y con una cuenta de administrador con contraseña temporal", async () => {
    const { organization, admin } = await newOrganizer();
    expect(organization.isPlatform).toBe(false);
    expect(organization.status).toBe("ACTIVE");
    expect(organization.contactEmail).toBe(organization.contactEmail?.toLowerCase());

    const [events, venues, members] = await Promise.all([
      prisma.event.count({ where: { organizationId: organization.id } }),
      prisma.venue.count({ where: { organizationId: organization.id } }),
      prisma.membership.findMany({ where: { organizationId: organization.id } }),
    ]);
    expect([events, venues]).toEqual([0, 0]);
    expect(members.map((m) => [m.userId, m.role])).toEqual([[admin.id, "ADMIN"]]);
    expect(admin.mustChangePassword).toBe(true);

    const login = await verifyStaffCredentials(admin.email, PASSWORD);
    expect(login?.organizationId).toBe(organization.id);
  });

  it("no se puede repetir el email de una cuenta existente", async () => {
    const { admin } = await newOrganizer();
    const actor = await impactaAdmin();
    await expect(
      createOrganizer({ name: "Otra", admin: { name: "X", email: admin.email, password: PASSWORD }, actorId: actor.id }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("cambiar la contraseña verifica la actual y deja de ser temporal", async () => {
    const { admin } = await newOrganizer();
    expect(await changeStaffPassword(admin.id, "incorrecta", "NuevaClave2026")).toBe(false);
    expect(await changeStaffPassword(admin.id, PASSWORD, "NuevaClave2026")).toBe(true);
    const saved = await prisma.staffUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(saved.mustChangePassword).toBe(false);
    expect(await verifyStaffCredentials(admin.email, "NuevaClave2026")).not.toBeNull();
    expect(await verifyStaffCredentials(admin.email, PASSWORD)).toBeNull();
  });
});

describe("revisión de eventos", () => {
  it("el organizador envía, IMPACTA aprueba y recién ahí se vende", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    await prisma.event.update({ where: { id: session.eventId }, data: { status: "DRAFT" } });
    const actor = await impactaAdmin();
    const items = [{ ticketTypeId: types[0]!.id, quantity: 1 }];

    await submitEventForReview(session.eventId, actor.id);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: session.eventId } })).status).toBe("PENDING_REVIEW");
    // En revisión todavía no se vende.
    await expect(createPendingOrder({ sessionId: session.id, items, buyer: buyer(1) })).rejects.toMatchObject({ code: "NOT_ON_SALE" });

    await approveEvent(session.eventId, actor.id);
    const approved = await prisma.event.findUniqueOrThrow({ where: { id: session.eventId } });
    expect(approved.status).toBe("PUBLISHED");
    expect(approved.publishedAt).not.toBeNull();
    await expect(createPendingOrder({ sessionId: session.id, items, buyer: buyer(2) })).resolves.toBeTruthy();
  });

  it("IMPACTA lo devuelve con una observación y queda en borrador", async () => {
    const { session } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    await prisma.event.update({ where: { id: session.eventId }, data: { status: "DRAFT" } });
    const actor = await impactaAdmin();
    await submitEventForReview(session.eventId, actor.id);

    await expect(rejectEvent(session.eventId, "", actor.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await rejectEvent(session.eventId, "La imagen no corresponde al evento.", actor.id);
    const saved = await prisma.event.findUniqueOrThrow({ where: { id: session.eventId } });
    expect([saved.status, saved.reviewNote]).toEqual(["DRAFT", "La imagen no corresponde al evento."]);
    // Solo se aprueba lo que está esperando revisión.
    await expect(approveEvent(session.eventId, actor.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("no se envía un evento al que le faltan entradas", async () => {
    const { session } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    await prisma.event.update({ where: { id: session.eventId }, data: { status: "DRAFT" } });
    await prisma.ticketType.deleteMany({ where: { sessionId: session.id } });
    const actor = await impactaAdmin();
    await expect(submitEventForReview(session.eventId, actor.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("organizador suspendido", () => {
  it("sus cuentas no entran y sus eventos no se venden; al reactivarlo vuelve todo", async () => {
    const { organization, admin } = await newOrganizer();
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    await prisma.event.update({ where: { id: session.eventId }, data: { organizationId: organization.id } });
    const actor = await impactaAdmin();
    const items = [{ ticketTypeId: types[0]!.id, quantity: 1 }];

    await setOrganizationStatus(organization.id, "SUSPENDED", actor.id);
    expect(await verifyStaffCredentials(admin.email, PASSWORD)).toBeNull();
    await expect(createPendingOrder({ sessionId: session.id, items, buyer: buyer(1) })).rejects.toMatchObject({ code: "NOT_ON_SALE" });

    await setOrganizationStatus(organization.id, "ACTIVE", actor.id);
    expect(await verifyStaffCredentials(admin.email, PASSWORD)).not.toBeNull();
    await expect(createPendingOrder({ sessionId: session.id, items, buyer: buyer(2) })).resolves.toBeTruthy();
  });

  it("la plataforma no se puede suspender", async () => {
    const platform = await prisma.organization.create({
      data: { name: "Plataforma", slug: `plataforma-${randomCode(6).toLowerCase()}`, currency: "BOB", isPlatform: true },
    });
    const actor = await impactaAdmin();
    await expect(setOrganizationStatus(platform.id, "SUSPENDED", actor.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
