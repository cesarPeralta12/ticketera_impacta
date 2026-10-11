/**
 * Límite de eventos activos por organizador: cuenta borradores, revisión y publicados que no pasaron;
 * no cuenta cancelados ni realizados; frena solo la creación; la plataforma no tiene límite.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { DomainError } from "../src/operations/shared";
import { createEventWithinLimit, getEventQuota, setMaxActiveEvents } from "../src/operations/event-limit";

afterAll(() => prisma.$disconnect());

const DAY = 24 * 3_600_000;

async function organizer(opts: { limit?: number | null; platform?: boolean } = {}) {
  const suffix = randomCode(6).toLowerCase();
  const org = await prisma.organization.create({
    data: { name: `Org ${suffix}`, slug: `org-${suffix}`, currency: "BOB", isPlatform: opts.platform ?? false, maxActiveEvents: opts.limit ?? null },
  });
  const venue = await prisma.venue.create({ data: { organizationId: org.id, name: "Sala" } });
  const actor = await prisma.staffUser.create({ data: { email: `a-${suffix}@prueba.test`, name: "Admin", passwordHash: "!" } });
  return { org, venue, actor };
}

let n = 0;
const newEvent = (organizationId: string, extra: Partial<{ status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "CANCELLED" }> = {}) => ({
  organizationId,
  slug: `evento-${randomCode(8).toLowerCase()}-${n++}`,
  title: "Evento de prueba",
  ...extra,
});

async function addSession(eventId: string, venueId: string, startsInDays: number) {
  await prisma.eventSession.create({ data: { eventId, venueId, startsAt: new Date(Date.now() + startsInDays * DAY) } });
}

describe("conteo de eventos activos", () => {
  it("cuenta borrador, en revisión y publicado; no cuenta cancelados", async () => {
    const { org } = await organizer({ limit: 10 });
    for (const status of ["DRAFT", "PENDING_REVIEW", "PUBLISHED", "CANCELLED"] as const) await prisma.event.create({ data: newEvent(org.id, { status }) });
    expect(await getEventQuota(org.id)).toEqual({ limit: 10, used: 3, remaining: 7, reached: false });
  });

  it("un evento ya realizado (todas sus funciones pasaron) no cuenta, uno con una función por venir sí", async () => {
    const { org, venue } = await organizer({ limit: 5 });
    const past = await prisma.event.create({ data: newEvent(org.id, { status: "PUBLISHED" }) });
    await addSession(past.id, venue.id, -10);
    await addSession(past.id, venue.id, -3);
    const running = await prisma.event.create({ data: newEvent(org.id, { status: "PUBLISHED" }) });
    await addSession(running.id, venue.id, -3); // ya empezó una función
    await addSession(running.id, venue.id, 20); // y queda otra
    const upcoming = await prisma.event.create({ data: newEvent(org.id, { status: "DRAFT" }) });
    await addSession(upcoming.id, venue.id, 40);
    expect((await getEventQuota(org.id)).used).toBe(2);
  });

  it("solo cuenta los eventos de su organizador", async () => {
    const a = await organizer({ limit: 3 });
    const b = await organizer({ limit: 3 });
    await prisma.event.create({ data: newEvent(a.org.id) });
    await prisma.event.create({ data: newEvent(b.org.id) });
    await prisma.event.create({ data: newEvent(b.org.id) });
    expect((await getEventQuota(a.org.id)).used).toBe(1);
    expect((await getEventQuota(b.org.id)).used).toBe(2);
  });

  it("sin límite no hay tope; la plataforma nunca tiene límite aunque tenga uno guardado", async () => {
    const free = await organizer({ limit: null });
    expect(await getEventQuota(free.org.id)).toEqual({ limit: null, used: 0, remaining: null, reached: false });
    const platform = await organizer({ limit: 1, platform: true });
    await prisma.event.create({ data: newEvent(platform.org.id) });
    await prisma.event.create({ data: newEvent(platform.org.id) });
    expect(await getEventQuota(platform.org.id)).toMatchObject({ limit: null, reached: false });
    await expect(createEventWithinLimit(newEvent(platform.org.id))).resolves.toBeTruthy();
  });
});

describe("crear con límite", () => {
  it("crea hasta el límite y luego rechaza con un mensaje claro", async () => {
    const { org } = await organizer({ limit: 2 });
    await createEventWithinLimit(newEvent(org.id));
    await createEventWithinLimit(newEvent(org.id));
    const error = await createEventWithinLimit(newEvent(org.id)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("EVENT_LIMIT");
    expect((error as DomainError).message).toContain("límite de 2 eventos activos");
    expect(await prisma.event.count({ where: { organizationId: org.id } })).toBe(2);
  });

  it("límite 0 bloquea todo; un evento realizado o cancelado libera lugar", async () => {
    const zero = await organizer({ limit: 0 });
    await expect(createEventWithinLimit(newEvent(zero.org.id))).rejects.toMatchObject({ code: "EVENT_LIMIT" });

    const { org, venue } = await organizer({ limit: 1 });
    const first = await createEventWithinLimit(newEvent(org.id, { status: "PUBLISHED" }));
    await expect(createEventWithinLimit(newEvent(org.id))).rejects.toMatchObject({ code: "EVENT_LIMIT" });
    await addSession(first.id, venue.id, -2); // el evento ya se realizó
    await expect(createEventWithinLimit(newEvent(org.id))).resolves.toBeTruthy();
    const second = await prisma.event.findFirstOrThrow({ where: { organizationId: org.id, sessions: { none: {} } } });
    await prisma.event.update({ where: { id: second.id }, data: { status: "CANCELLED" } });
    await expect(createEventWithinLimit(newEvent(org.id))).resolves.toBeTruthy();
  });

  it("dos creaciones a la vez no pueden pasarse del límite", async () => {
    const { org } = await organizer({ limit: 1 });
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => createEventWithinLimit(newEvent(org.id))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.event.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("bajar el límite por debajo de lo que ya tiene no borra nada, solo frena los nuevos", async () => {
    const { org, actor } = await organizer({ limit: 5 });
    for (let i = 0; i < 3; i++) await createEventWithinLimit(newEvent(org.id));
    await setMaxActiveEvents(org.id, 1, actor.id);
    expect(await getEventQuota(org.id)).toEqual({ limit: 1, used: 3, remaining: 0, reached: true });
    expect(await prisma.event.count({ where: { organizationId: org.id } })).toBe(3);
    await expect(createEventWithinLimit(newEvent(org.id))).rejects.toMatchObject({ code: "EVENT_LIMIT" });
  });
});

describe("fijar el límite (IMPACTA)", () => {
  it("guarda el valor, lo deja en el registro y permite quitarlo", async () => {
    const { org, actor } = await organizer();
    await setMaxActiveEvents(org.id, 4, actor.id);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).maxActiveEvents).toBe(4);
    await setMaxActiveEvents(org.id, null, actor.id);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).maxActiveEvents).toBeNull();
    const log = await prisma.auditLog.findMany({ where: { entityId: org.id, action: "organizer.event_limit" }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.data)).toEqual([{ before: null, after: 4 }, { before: 4, after: null }]);
  });

  it("rechaza valores inválidos y la plataforma", async () => {
    const { org, actor } = await organizer();
    for (const bad of [-1, 1.5, 100_000, Number.NaN]) await expect(setMaxActiveEvents(org.id, bad, actor.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const platform = await organizer({ platform: true });
    await expect(setMaxActiveEvents(platform.org.id, 3, actor.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(setMaxActiveEvents("no-existe", 3, actor.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
