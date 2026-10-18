/**
 * Estado por mesa para anfitriones: libre, vendida u ocupada (alguien entró), en mesas con sillas y en mesas de una
 * zona sin mapa.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode, seatedTableSeats, seatedTablesGrid, type SeatedTablesLayout } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { applyPaymentUpdate, startPayment } from "../src/operations/payments";
import { getTableStates } from "../src/operations/tables-live";
import { buyer, createGeneralAdmissionEvent, createPendingOrder } from "./fixtures";

afterAll(() => prisma.$disconnect());

async function pay(code: string) {
  const payment = await startPayment(code, "test");
  await applyPaymentUpdate({ paymentId: payment.id, provider: "test", providerPaymentId: `p-${payment.id}`, status: "APPROVED", providerStatus: "ok", amount: payment.amount, currency: payment.currency });
}

describe("mesas en vivo", () => {
  it("mesas con sillas: libre, vendida y ocupada", async () => {
    const suffix = randomCode(6).toLowerCase();
    const org = await prisma.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}`, currency: "BOB" } });
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: "Salón" } });
    const layout: SeatedTablesLayout = { type: "seated", prefix: "Mesa", shape: "round", chairs: 4, mode: "SEAT", min: 1, max: 4, size: 20, tables: seatedTablesGrid({ count: 3, perRow: 3, x: 150, y: 150, gapX: 150, gapY: 150 }) };
    const section = await prisma.section.create({
      data: { venueId: venue.id, name: "Mesas", seatingMode: "RESERVED", capacity: 12, layout, seats: { createMany: { data: seatedTableSeats(layout) } } },
      include: { seats: true },
    });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        slug: `cena-${suffix}`,
        title: "Cena",
        status: "PUBLISHED",
        sessions: { create: { venueId: venue.id, startsAt: new Date(Date.now() + 86_400_000), ticketTypes: { create: { name: "Silla", sectionId: section.id, unitAmount: 5_000, currency: "BOB", capacity: 12 } } } },
      },
      include: { sessions: { include: { ticketTypes: true } } },
    });
    const session = event.sessions[0]!;
    const chairs = (table: number) => section.seats.filter((s) => s.row === String(table)).map((s) => s.id);
    const o1 = await createPendingOrder({ sessionId: session.id, buyer: buyer(31), items: [{ ticketTypeId: session.ticketTypes[0]!.id, quantity: 2, seatIds: chairs(1).slice(0, 2) }] });
    await pay(o1.code);
    const o2 = await createPendingOrder({ sessionId: session.id, buyer: buyer(32), items: [{ ticketTypeId: session.ticketTypes[0]!.id, quantity: 1, seatIds: chairs(2).slice(0, 1) }] });
    await pay(o2.code);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: o1.id } });
    await scanTicket({ sessionId: session.id, raw: ticket.code });

    const [group] = await getTableStates(session.id);
    expect(group!.tables.map((t) => [t.name, t.status, t.chairs?.sold, t.entered])).toEqual([
      ["Mesa 1", "OCCUPIED", 2, 1],
      ["Mesa 2", "SOLD", 1, 0],
      ["Mesa 3", "FREE", 0, 0],
    ]);
    expect(group!.freeCount).toBe(1);
  });

  it("mesas de una zona sin mapa: cada vendida con su número y las libres contadas", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 100, types: [{ name: "Mesa VIP", capacity: 5 }] });
    await prisma.ticketType.update({ where: { id: types[0]!.id }, data: { kind: "TABLE", peoplePerUnit: 4, consumptionAmount: 80_000 } });
    const order = await createPendingOrder({ sessionId: session.id, buyer: buyer(33), items: [{ ticketTypeId: types[0]!.id, quantity: 1 }] });
    await pay(order.code);
    const [group] = await getTableStates(session.id);
    expect(group).toMatchObject({ name: "Mesa VIP", freeCount: 4 });
    expect(group!.tables[0]).toMatchObject({ name: "Mesa VIP 1", status: "SOLD", people: 4, consumption: { left: 80_000 } });
  });
});
