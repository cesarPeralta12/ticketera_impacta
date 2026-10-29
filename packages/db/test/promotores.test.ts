/**
 * Promotores: venden con cobro por QR los eventos asignados (nunca efectivo) y su comisión sube recién cuando el
 * pago queda aprobado. Lo que se compra en la web con su código también suma.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { createStaffUser } from "../src/operations/accounts";
import {
  SIMULATED_PROVIDER,
  approveSimulatedPayment,
  assignPromoter,
  promoterSales,
  promotersReport,
  sellAsPromoter,
} from "../src/operations/promoters";
import { buyer, createGeneralAdmissionEvent, createPendingOrder } from "./fixtures";

afterAll(() => prisma.$disconnect());

let n = 0;
async function setup(rule: { commissionType: "PERCENT" | "FIXED"; commissionValue: number }) {
  const { session, types } = await createGeneralAdmissionEvent({
    sectionCapacity: 100,
    types: [{ name: "General", capacity: 100, unitAmount: 10_000 }],
  });
  const event = await prisma.event.findUniqueOrThrow({ where: { id: session.eventId } });
  const promoter = await createStaffUser({
    organizationId: event.organizationId,
    name: "Juan Pérez",
    email: `promotor-${randomCode(6).toLowerCase()}@prueba.test`,
    password: "Promotor2026!",
    role: "PROMOTER",
  });
  const { code } = await assignPromoter({ organizationId: event.organizationId, userId: promoter!.id, eventId: event.id, rule });
  return { session, event, type: types[0]!, promoter: promoter!, code };
}

const sell = (sessionId: string, ticketTypeId: string, quantity: number, promoterId: string) =>
  sellAsPromoter(
    { sessionId, items: [{ ticketTypeId, quantity }], buyer: buyer(8_000 + ++n) },
    { promoterId, buyerPhone: "77123456", provider: SIMULATED_PROVIDER },
  );

describe("promotores", () => {
  it("la venta queda esperando el pago QR y la comisión sube recién al pagarse", async () => {
    const { session, type, promoter, event } = await setup({ commissionType: "PERCENT", commissionValue: 10 });
    const { order, payment } = await sell(session.id, type.id, 3, promoter.id);
    expect(order).toMatchObject({ channel: "PROMOTER", status: "PENDING_PAYMENT", promoterId: promoter.id, commissionAmount: 3_000, buyerPhone: "77123456" });
    expect(payment).toMatchObject({ provider: SIMULATED_PROVIDER, status: "PENDING" });
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);

    let sales = await promoterSales(promoter.id, { organizationId: event.organizationId });
    expect(sales.totals).toMatchObject({ orders: 0, commission: 0, waitingOrders: 1, waitingCommission: 3_000 });

    expect(await approveSimulatedPayment(order.code)).toBe("PAID");
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(3);
    sales = await promoterSales(promoter.id, { organizationId: event.organizationId });
    expect(sales.totals).toMatchObject({ orders: 1, tickets: 3, amount: 30_000, commission: 3_000, waitingOrders: 0 });
    expect(sales.byEvent).toEqual([expect.objectContaining({ eventId: event.id, tickets: 3, commission: 3_000 })]);
    // Pagar dos veces no duplica nada.
    expect(await approveSimulatedPayment(order.code)).toBe("PAID");
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(3);
  });

  it("comisión fija: un monto por cada entrada vendida", async () => {
    const { session, type, promoter } = await setup({ commissionType: "FIXED", commissionValue: 1_500 });
    const { order } = await sell(session.id, type.id, 4, promoter.id);
    expect(order.commissionAmount).toBe(6_000);
  });

  it("no puede vender un evento que no tiene asignado", async () => {
    const { promoter } = await setup({ commissionType: "PERCENT", commissionValue: 10 });
    const other = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    await expect(sell(other.session.id, other.types[0]!.id, 1, promoter.id)).rejects.toThrow(/No tienes asignado este evento/);
  });

  it("lo que se compra en la web con su código (sin descuento) también suma a su comisión", async () => {
    const { session, type, promoter, code, event } = await setup({ commissionType: "PERCENT", commissionValue: 10 });
    expect(code.code).toMatch(/^RP-JUAN-/);
    const order = await createPendingOrder(
      { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 2 }], buyer: buyer(8_500 + ++n) },
      { promoCode: code.code.toLowerCase() },
    );
    expect(order).toMatchObject({ channel: "ONLINE", promoterId: promoter.id, commissionAmount: 2_000, totalAmount: 20_000, discountAmount: 0 });
    await prisma.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date() } });
    const [row] = (await promotersReport(event.organizationId)).filter((p) => p.id === promoter.id);
    expect(row).toMatchObject({ orders: 1, amount: 20_000, commission: 2_000, code: code.code });
  });

  it("asignar dos veces actualiza la comisión y no crea otro código", async () => {
    const { event, promoter, code } = await setup({ commissionType: "PERCENT", commissionValue: 10 });
    const again = await assignPromoter({ organizationId: event.organizationId, userId: promoter.id, eventId: event.id, rule: { commissionType: "FIXED", commissionValue: 500 } });
    expect(again.code.id).toBe(code.id);
    expect(again.assignment).toMatchObject({ commissionType: "FIXED", commissionValue: 500 });
    await expect(
      assignPromoter({ organizationId: event.organizationId, userId: promoter.id, eventId: event.id, rule: { commissionType: "PERCENT", commissionValue: 150 } }),
    ).rejects.toThrow(/0 a 100/);
  });
});
