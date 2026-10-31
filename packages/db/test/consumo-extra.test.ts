/**
 * Consumo extra al comprar: el organizador define paquetes por tipo, el comprador elige uno y el QR de consumo lleva el
 * total (incluido + extra). El servidor rechaza lo que no sea un paquete, el total de la orden lo incluye y
 * «Mis entradas» lista los QR de consumo del comprador aunque sus entradas se hayan transferido.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { DomainError } from "../src/operations/shared";
import { applyPaymentUpdate, startPayment } from "../src/operations/payments";
import { listCustomerVouchers, nightConsumption, redeemVoucher } from "../src/operations/nightlife";
import { createStaffUser } from "../src/operations/accounts";
import { createPromoCode } from "../src/operations/promos";
import { addSessionSeller } from "../src/operations/sales-scope";
import { buyer, createGeneralAdmissionEvent, createPendingOrder } from "./fixtures";

afterAll(() => prisma.$disconnect());

const unique = () => randomCode(6).toLowerCase();

async function setup() {
  const { session, types } = await createGeneralAdmissionEvent({
    sectionCapacity: 100,
    types: [
      { name: "Mesa Box", capacity: 10, unitAmount: 150_000 },
      { name: "Entrada + chop", capacity: 50, unitAmount: 6_500 },
      { name: "General", capacity: 50, unitAmount: 5_000 },
    ],
  });
  const full = await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id }, include: { event: true } });
  await prisma.event.update({ where: { id: full.eventId }, data: { status: "PUBLISHED" } });
  await prisma.eventSession.update({ where: { id: session.id }, data: { startsAt: new Date(Date.now() + 3_600_000) } });
  const [mesa, chop, general] = types;
  await prisma.ticketType.update({
    where: { id: mesa!.id },
    data: { kind: "TABLE", peoplePerUnit: 4, consumptionAmount: 120_000, extraConsumptionOptions: [10_000, 30_000, 50_000] },
  });
  await prisma.ticketType.update({ where: { id: chop!.id }, data: { consumptionAmount: 2_000, extraConsumptionOptions: [2_000] } });
  return { session, orgId: full.event.organizationId, mesa: mesa!.id, chop: chop!.id, general: general!.id };
}

async function buy(sessionId: string, items: { ticketTypeId: string; quantity: number; extraConsumption?: number }[], n: number, customerId?: string) {
  const order = await createPendingOrder({ sessionId, items, buyer: buyer(n) }, customerId ? { customerId, channel: "POS" } : {});
  const payment = await startPayment(order.code, "directo");
  await applyPaymentUpdate({ paymentId: payment.id, provider: "directo", providerPaymentId: `directo_${payment.id}`, status: "APPROVED", providerStatus: "pase_directo", amount: payment.amount, currency: payment.currency });
  return order;
}

describe("consumo extra", () => {
  it("una mesa con extra cobra el precio más el extra y su QR lleva el total, con el desglose", async () => {
    const { session, mesa } = await setup();
    const order = await buy(session.id, [{ ticketTypeId: mesa, quantity: 1, extraConsumption: 30_000 }], 1);
    expect(order.totalAmount).toBe(180_000); // mesa Bs 1.500 + extra Bs 300
    const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(lines[0]).toMatchObject({ unitAmount: 150_000, extraConsumption: 30_000 });
    const credit = await prisma.consumptionCredit.findFirstOrThrow({ where: { orderId: order.id } });
    expect(credit).toMatchObject({ amount: 150_000, extraAmount: 30_000 }); // Bs 1.200 incluido + Bs 300 extra
    // Cuatro personas, un solo QR de consumo para toda la mesa.
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(4);
    expect(await prisma.consumptionCredit.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("sin extra, todo sigue como antes", async () => {
    const { session, mesa } = await setup();
    const order = await buy(session.id, [{ ticketTypeId: mesa, quantity: 1 }], 2);
    expect(order.totalAmount).toBe(150_000);
    const credit = await prisma.consumptionCredit.findFirstOrThrow({ where: { orderId: order.id } });
    expect(credit).toMatchObject({ amount: 120_000, extraAmount: 0 });
  });

  it("el servidor rechaza un monto que no es uno de los paquetes", async () => {
    const { session, mesa } = await setup();
    await expect(createPendingOrder({ sessionId: session.id, items: [{ ticketTypeId: mesa, quantity: 1, extraConsumption: 12_345 }], buyer: buyer(3) })).rejects.toMatchObject({ code: "INVALID_ITEMS" });
  });

  it("rechaza el extra en un tipo sin consumo, aunque el monto parezca válido", async () => {
    const { session, general } = await setup();
    await prisma.ticketType.update({ where: { id: general }, data: { extraConsumptionOptions: [10_000] } });
    const attempt = createPendingOrder({ sessionId: session.id, items: [{ ticketTypeId: general, quantity: 1, extraConsumption: 10_000 }], buyer: buyer(4) });
    await expect(attempt).rejects.toBeInstanceOf(DomainError);
  });

  it("un tipo que no definió paquetes no vende extra", async () => {
    const { session, chop } = await setup();
    await prisma.ticketType.update({ where: { id: chop }, data: { extraConsumptionOptions: [] } });
    await expect(createPendingOrder({ sessionId: session.id, items: [{ ticketTypeId: chop, quantity: 1, extraConsumption: 2_000 }], buyer: buyer(5) })).rejects.toMatchObject({ code: "INVALID_ITEMS" });
  });

  it("en una entrada con trago el extra va por unidad: dos entradas con extra son dos QR de consumo", async () => {
    const { session, chop } = await setup();
    const order = await buy(session.id, [{ ticketTypeId: chop, quantity: 2, extraConsumption: 2_000 }], 6);
    expect(order.totalAmount).toBe(2 * (6_500 + 2_000));
    const credits = await prisma.consumptionCredit.findMany({ where: { orderId: order.id } });
    expect(credits).toHaveLength(2);
    for (const c of credits) expect(c).toMatchObject({ amount: 4_000, extraAmount: 2_000 });
  });

  it("un código de descuento baja el precio pero no toca el extra", async () => {
    const { session, orgId, mesa } = await setup();
    const admin = (await createStaffUser({ organizationId: orgId, name: "Admin", email: `adm-${unique()}@prueba.test`, password: "Cuenta2026!", role: "ADMIN" }))!;
    const code = `EXTRA-${unique().toUpperCase()}`;
    await createPromoCode(orgId, { code, discountType: "PERCENT", discountValue: 10 }, admin.id);
    const order = await createPendingOrder({ sessionId: session.id, items: [{ ticketTypeId: mesa, quantity: 1, extraConsumption: 30_000 }], buyer: buyer(7) }, { promoCode: code });
    // 10% de la mesa (Bs 1.500) = Bs 150: el total es 1.500 + 300 − 150.
    expect(order.discountAmount).toBe(15_000);
    expect(order.totalAmount).toBe(150_000 + 30_000 - 15_000);
  });

  it("la barra lee el total una sola vez y la Barra separa lo incluido del extra", async () => {
    const { session, orgId, mesa } = await setup();
    const order = await buy(session.id, [{ ticketTypeId: mesa, quantity: 1, extraConsumption: 50_000 }], 8);
    const credit = await prisma.consumptionCredit.findFirstOrThrow({ where: { orderId: order.id } });
    const bar = (await createStaffUser({ organizationId: orgId, name: "Barra", email: `barra-${unique()}@prueba.test`, password: "Cuenta2026!", role: "BAR", salesScope: "ASSIGNED" }))!;
    await addSessionSeller({ organizationId: orgId, userId: bar.id, sessionId: session.id });

    const first = await redeemVoucher({ raw: credit.code, sessionId: session.id, staffId: bar.id });
    expect(first).toMatchObject({ status: "REDEEMED", voucher: { amount: 170_000, extra: 50_000 } });
    expect(await redeemVoucher({ raw: credit.code, sessionId: session.id, staffId: bar.id })).toMatchObject({ status: "ALREADY_REDEEMED" });

    const night = await nightConsumption(session.id);
    expect(night).toMatchObject({ amount: 170_000, extra: 50_000, spent: 170_000 });
    expect(night.byType[0]).toMatchObject({ extra: 50_000 });
  });

  it("«Mis entradas» lista los QR de consumo del comprador, con su extra, aunque transfiera las entradas", async () => {
    const { session, mesa } = await setup();
    const comprador = await prisma.customer.create({ data: { email: `c-${unique()}@prueba.test`, name: "Comprador Prueba", passwordHash: "x", documentId: `9${Date.now().toString().slice(-6)}`, emailVerified: true } });
    const order = await buy(session.id, [{ ticketTypeId: mesa, quantity: 1, extraConsumption: 10_000 }], 9, comprador.id);
    expect(order.customerId).toBe(comprador.id);

    // Las cuatro entradas pasan a otras cuentas: el consumo de la mesa sigue siendo de quien la compró.
    const otro = await prisma.customer.create({ data: { email: `o-${unique()}@prueba.test`, name: "Otra Persona", passwordHash: "x", documentId: `8${Date.now().toString().slice(-6)}`, emailVerified: true } });
    await prisma.ticket.updateMany({ where: { orderId: order.id }, data: { customerId: otro.id } });

    const vouchers = await listCustomerVouchers(comprador.id);
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]).toMatchObject({ amount: 130_000, extra: 10_000, shared: true, redeemedAt: null, cancelled: false });
    expect(await listCustomerVouchers(otro.id)).toEqual([]);
  });
});
