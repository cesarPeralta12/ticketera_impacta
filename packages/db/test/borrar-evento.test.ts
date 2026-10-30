/**
 * Borrar un evento con todo lo suyo: ventas pagadas, pagos, entradas, ingresos en puerta, código de descuento usado,
 * consumo, impresas e invitaciones. Otro evento de la misma organización no se toca.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { deleteEventCompletely, eventFootprint, hasHistory } from "../src/operations/event-delete";
import { createPrintBatch } from "../src/operations/printed";
import { createPromoCode } from "../src/operations/promos";
import { issueGuestTickets, sellAtBoxOffice } from "../src/operations/sales";
import { buyer, createGeneralAdmissionEvent, platformStaff } from "./fixtures";

afterAll(() => prisma.$disconnect());

let n = 0;

/** Un evento con de todo: venta en caja con código y consumo, una entrada leída en puerta, una invitación y un lote impreso. */
async function busyEvent() {
  const { session, types } = await createGeneralAdmissionEvent({
    sectionCapacity: 100,
    types: [
      { name: "General", capacity: 50, unitAmount: 10_000 },
      { name: "Con trago", capacity: 50, unitAmount: 15_000 },
    ],
  });
  const [general, withDrink] = types.toSorted((a, b) => a.unitAmount - b.unitAmount);
  await prisma.ticketType.update({ where: { id: withDrink!.id }, data: { consumptionAmount: 2_500 } });
  const event = await prisma.event.findUniqueOrThrow({ where: { id: session.eventId } });
  const staff = await platformStaff();
  const code = `BORRA${randomCode(5)}`;
  await createPromoCode(event.organizationId, { code, eventId: event.id, discountType: "PERCENT", discountValue: 10 }, staff.id);

  const sale = await sellAtBoxOffice(
    { sessionId: session.id, items: [{ ticketTypeId: general!.id, quantity: 2 }], buyer: buyer(9_500 + ++n) },
    { staffId: staff.id, method: "EFECTIVO", promoCode: code },
  );
  await sellAtBoxOffice({ sessionId: session.id, items: [{ ticketTypeId: withDrink!.id, quantity: 1 }], buyer: buyer(9_500 + ++n) }, { staffId: staff.id, method: "QR" });
  const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: sale.id } });
  expect((await scanTicket({ sessionId: session.id, raw: ticket.code })).result).toBe("ACCEPTED");
  await issueGuestTickets({ ticketTypeId: general!.id, guests: [{ name: "Invitada Uno" }], staffId: staff.id });
  await createPrintBatch({ sessionId: session.id, ticketTypeId: general!.id, quantity: 5, mode: "ACTIVATE_ON_SALE", staffId: staff.id });
  return { event, session, staff };
}

describe("borrar un evento con todo lo suyo", () => {
  it("cuenta lo que se pierde antes de borrar", async () => {
    const { event } = await busyEvent();
    const f = await eventFootprint(event.id);
    // 2 ventas cobradas; además 1 invitación y 5 impresas (órdenes de Bs 0).
    expect(f).toMatchObject({ sessions: 1, orders: 8, sales: 2, scans: 1, promoCodes: 1 });
    expect(f.paidAmount).toBe(2 * 9_000 + 15_000); // la venta con código lleva 10% menos
    expect(f.tickets).toBeGreaterThanOrEqual(2 + 1 + 1 + 5);
    expect(hasHistory(f)).toBe(true);
  });

  it("borra ventas, pagos, entradas, lecturas, código, consumo, impresas e invitaciones; otro evento queda igual", async () => {
    const { event, session } = await busyEvent();
    const other = await busyEvent();
    const before = await eventFootprint(other.event.id);
    const orderIds = (await prisma.order.findMany({ where: { items: { some: { ticketType: { sessionId: session.id } } } }, select: { id: true } })).map((o) => o.id);
    expect(orderIds.length).toBeGreaterThan(0);
    expect(await prisma.consumptionCredit.count({ where: { sessionId: session.id } })).toBe(1);

    await deleteEventCompletely(event.id);

    expect(await prisma.event.findUnique({ where: { id: event.id } })).toBeNull();
    expect(await prisma.eventSession.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.order.count({ where: { id: { in: orderIds } } })).toBe(0);
    expect(await prisma.payment.count({ where: { orderId: { in: orderIds } } })).toBe(0);
    expect(await prisma.ticket.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.accessScan.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.consumptionCredit.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.printBatch.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.promoRedemption.count({ where: { orderId: { in: orderIds } } })).toBe(0);
    // El código no queda suelto (sin evento valdría para todos los eventos de la organización).
    expect(await prisma.promoCode.count({ where: { organizationId: event.organizationId, eventId: null } })).toBe(0);

    expect(await eventFootprint(other.event.id)).toEqual(before);
  });

  it("un evento vacío también se borra", async () => {
    const { session } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    const f = await deleteEventCompletely(session.eventId);
    expect(hasHistory(f)).toBe(false);
    expect(await prisma.event.findUnique({ where: { id: session.eventId } })).toBeNull();
  });
});
