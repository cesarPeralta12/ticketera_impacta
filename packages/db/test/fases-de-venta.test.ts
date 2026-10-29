/**
 * Fases de venta (Fase Hot, Fase 1, Fase 2…): en una sección se vende una sola fase a la vez. La siguiente toma el
 * lugar cuando se agota la anterior o cuando llega su fecha, y una fase que terminó no vuelve.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { duplicateSession } from "../src/operations/nightlife";
import { getSessionStock, withSessionPhases } from "../src/operations/orders";
import { buyer, createGeneralAdmissionEvent, createPendingOrder, platformStaff } from "./fixtures";

afterAll(() => prisma.$disconnect());

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

/** Fase Hot (5), Fase 1 (20) y Fase 2 (30, empieza en 5 días aunque la Fase 1 no se agote). */
async function carnaval() {
  const { session, types } = await createGeneralAdmissionEvent({
    sectionCapacity: 100,
    types: [
      { name: "Fase Hot", capacity: 5, unitAmount: 5_000 },
      { name: "Fase 1", capacity: 20, unitAmount: 8_000 },
      { name: "Fase 2", capacity: 30, unitAmount: 10_000 },
    ],
  });
  const [hot, first, second] = types.toSorted((a, b) => a.unitAmount - b.unitAmount);
  await prisma.ticketType.update({ where: { id: hot!.id }, data: { phaseOrder: 1 } });
  await prisma.ticketType.update({ where: { id: first!.id }, data: { phaseOrder: 2 } });
  await prisma.ticketType.update({ where: { id: second!.id }, data: { phaseOrder: 3, phaseStartsAt: days(5) } });
  return { session, hot: hot!, first: first!, second: second! };
}

let n = 0;
async function buy(sessionId: string, ticketTypeId: string, quantity: number, now?: Date) {
  const order = await createPendingOrder({ sessionId, items: [{ ticketTypeId, quantity }], buyer: buyer(9_000 + ++n) }, { now });
  // Pagada: cuenta para siempre (una reserva sin pagar vence).
  await prisma.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: now ?? new Date() } });
  return order;
}

async function states(sessionId: string, now?: Date) {
  const types = await prisma.ticketType.findMany({ where: { sessionId } });
  const phased = await withSessionPhases(sessionId, types, now);
  return Object.fromEntries(phased.map((t) => [t.name, t.phase?.state]));
}

describe("fases de venta", () => {
  it("al principio solo se vende la Fase Hot: las siguientes se rechazan", async () => {
    const { session, first, second } = await carnaval();
    expect(await states(session.id)).toEqual({ "Fase Hot": "active", "Fase 1": "upcoming", "Fase 2": "upcoming" });
    await expect(buy(session.id, first.id, 1)).rejects.toThrow(/todavía no empieza: primero se vende "Fase Hot"/);
    await expect(buy(session.id, second.id, 1)).rejects.toThrow(/todavía no empieza/);
  });

  it("cuando se agota la Fase Hot empieza la Fase 1, y la Hot ya no se vende", async () => {
    const { session, hot, first } = await carnaval();
    await buy(session.id, hot.id, 3);
    await buy(session.id, hot.id, 2);
    expect(await states(session.id)).toEqual({ "Fase Hot": "done", "Fase 1": "active", "Fase 2": "upcoming" });
    await buy(session.id, first.id, 4);
    expect((await getSessionStock(session.id)).remaining.get(first.id)).toBe(16);
    await expect(buy(session.id, hot.id, 1)).rejects.toThrow(/"Fase Hot" ya terminó: ahora se vende "Fase 1"/);
  });

  it("al llegar su fecha empieza la Fase 2 aunque la Fase 1 no se haya agotado", async () => {
    const { session, hot, first, second } = await carnaval();
    await buy(session.id, hot.id, 5);
    await buy(session.id, first.id, 2);
    const later = days(6);
    expect(await states(session.id, later)).toEqual({ "Fase Hot": "done", "Fase 1": "done", "Fase 2": "active" });
    await expect(buy(session.id, first.id, 1, later)).rejects.toThrow(/"Fase 1" ya terminó: ahora se vende "Fase 2"/);
    await buy(session.id, second.id, 2, later);
  });

  it("no hay vuelta atrás: si se libera un lugar de una fase terminada, sigue terminada", async () => {
    const { session, hot, first } = await carnaval();
    const hotOrder = await buy(session.id, hot.id, 5);
    await buy(session.id, first.id, 1);
    // Se reembolsa una compra de la Fase Hot: vuelven a quedar 5 lugares, pero ya se vende la Fase 1.
    await prisma.order.update({ where: { id: hotOrder.id }, data: { status: "REFUNDED" } });
    expect((await getSessionStock(session.id)).remaining.get(hot.id)).toBe(5);
    expect(await states(session.id)).toEqual({ "Fase Hot": "done", "Fase 1": "active", "Fase 2": "upcoming" });
    await expect(buy(session.id, hot.id, 1)).rejects.toThrow(/ya terminó/);
  });

  it("al duplicar la función, la copia sigue con sus fases (no se venden todas a la vez)", async () => {
    const { session, hot } = await carnaval();
    const staff = await platformStaff();
    const date = new Date(session.startsAt.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const copy = await duplicateSession({ templateSessionId: session.id, date, staffId: staff.id });
    expect(await states(copy.id)).toEqual({ "Fase Hot": "active", "Fase 1": "upcoming", "Fase 2": "upcoming" });
    const copied = await prisma.ticketType.findFirstOrThrow({ where: { sessionId: copy.id, name: "Fase 2" } });
    const original = await prisma.ticketType.findFirstOrThrow({ where: { sessionId: session.id, name: "Fase 2" } });
    // La fecha de la fase se corre igual que la función.
    expect(copied.phaseStartsAt!.getTime() - original.phaseStartsAt!.getTime()).toBe(copy.startsAt.getTime() - session.startsAt.getTime());
    expect((await prisma.ticketType.findFirstOrThrow({ where: { sessionId: copy.id, name: "Fase Hot" } })).phaseOrder).toBe(hot.phaseOrder ?? 1);
  });

  it("los precios comunes de otras secciones no cambian", async () => {
    const { session, hot } = await carnaval();
    const other = await prisma.ticketType.create({
      data: { sessionId: session.id, name: "VIP", unitAmount: 20_000, currency: "CLP", capacity: 10 },
    });
    expect((await states(session.id))["VIP"]).toBeUndefined();
    await buy(session.id, other.id, 1);
    await buy(session.id, hot.id, 1);
  });
});
