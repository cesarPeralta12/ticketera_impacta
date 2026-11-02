/**
 * Entradas vendidas de un evento con su historia: la etapa se congela al comprar (preventa, fase o venta), lo vendido
 * antes de guardarla se estima, y la historia cuenta la compra y cada transferencia.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { applyPaymentUpdate, startPayment } from "../src/operations/payments";
import { listSoldTickets, soldTicketHistory } from "../src/operations/sold";
import { buyer, createGeneralAdmissionEvent, createPendingOrder } from "./fixtures";

afterAll(() => prisma.$disconnect());

async function buy(sessionId: string, ticketTypeId: string, n: number) {
  const order = await createPendingOrder({ sessionId, items: [{ ticketTypeId, quantity: 1 }], buyer: buyer(n) });
  const payment = await startPayment(order.code, "directo");
  await applyPaymentUpdate({ paymentId: payment.id, provider: "directo", providerPaymentId: `directo_${payment.id}`, status: "APPROVED", providerStatus: "pase_directo", amount: payment.amount, currency: payment.currency });
  return order;
}

async function setup() {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 50, types: [{ name: "General", capacity: 30, unitAmount: 10_000 }] });
  const full = await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id } });
  await prisma.event.update({ where: { id: full.eventId }, data: { status: "PUBLISHED" } });
  await prisma.eventSession.update({ where: { id: session.id }, data: { startsAt: new Date(Date.now() + 3_600_000) } });
  return { session, eventId: full.eventId, typeId: types[0]!.id };
}

describe("entradas vendidas", () => {
  it("la etapa queda congelada al comprar: venta, y preventa mientras dura el descuento", async () => {
    const { session, eventId, typeId } = await setup();
    const normal = await buy(session.id, typeId, 1);
    await prisma.ticketType.update({
      where: { id: typeId },
      data: { discountPercent: 20, discountStartsAt: null, discountEndsAt: new Date(Date.now() + 86_400_000) },
    });
    const presale = await buy(session.id, typeId, 2);
    // Termina la preventa: lo ya vendido conserva su etapa.
    await prisma.ticketType.update({ where: { id: typeId }, data: { discountEndsAt: new Date(Date.now() - 1000) } });

    const stages = await prisma.orderItem.findMany({ where: { orderId: { in: [normal.id, presale.id] } }, select: { orderId: true, saleStage: true } });
    expect(stages.find((s) => s.orderId === normal.id)?.saleStage).toBe("Venta");
    expect(stages.find((s) => s.orderId === presale.id)?.saleStage).toBe("Preventa");

    const { total, rows } = await listSoldTickets({ eventId });
    expect(total).toBe(2);
    const fromPresale = rows.find((r) => r.orderCode === presale.code)!;
    expect(fromPresale.stage).toEqual({ text: "Preventa", estimated: false });
    expect(fromPresale.price).toBe(8_000);
  });

  it("lo vendido antes de guardar la etapa se estima con las fechas del tipo", async () => {
    const { session, eventId, typeId } = await setup();
    const order = await buy(session.id, typeId, 3);
    await prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { saleStage: null } });
    const { rows } = await listSoldTickets({ eventId });
    expect(rows[0]!.stage).toEqual({ text: "Venta", estimated: true });
  });

  it("busca por código, comprador o carnet, y filtra por estado", async () => {
    const { session, eventId, typeId } = await setup();
    const a = await buy(session.id, typeId, 4);
    await buy(session.id, typeId, 5);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: a.id } });
    expect((await listSoldTickets({ eventId, q: ticket.code })).total).toBe(1);
    expect((await listSoldTickets({ eventId, q: buyer(4).name.slice(0, 6) })).total).toBeGreaterThanOrEqual(1);
    expect((await listSoldTickets({ eventId, status: "USED" })).total).toBe(0);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "CANCELLED" } });
    expect((await listSoldTickets({ eventId, status: "CANCELLED" })).total).toBe(1);
  });

  it("la historia cuenta la compra y cada transferencia, y el titular actual es quien la recibió", async () => {
    const { session, eventId, typeId } = await setup();
    const order = await buy(session.id, typeId, 6);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
    const customer = (name: string) => prisma.customer.create({ data: { email: `${randomCode(8).toLowerCase()}@prueba.test`, name, passwordHash: "!" } });
    const ana = await customer("Ana Pérez");
    const luis = await customer("Luis Rojas");
    await prisma.ticketTransfer.create({
      data: { ticketId: ticket.id, fromCustomerId: ana.id, toCustomerId: luis.id, status: "ACCEPTED", expiresAt: new Date(Date.now() + 1000), resolvedAt: new Date(), oldCode: ticket.code, newCode: "NUEVOCODE1" },
    });
    await prisma.ticket.update({ where: { id: ticket.id }, data: { customerId: luis.id, holderName: luis.name, transferCount: 1 } });

    const history = (await soldTicketHistory(ticket.id))!;
    expect(history.steps.map((s) => s.kind)).toEqual(["purchase", "transfer"]);
    expect(history.steps[1]).toMatchObject({ fromName: "Ana Pérez", toName: "Luis Rojas" });
    expect(history.holderName).toBe("Luis Rojas");
    expect(history.changedHands).toBe(true);

    expect((await listSoldTickets({ eventId, transferred: true })).total).toBe(1);
    expect((await listSoldTickets({ eventId, q: "Luis" })).total).toBe(1);
  });
});
