/**
 * Códigos promocionales: descuento en la orden, límites de uso, vigencia, combinación con la preventa,
 * concurrencia y medición por promotor.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { applyPaymentUpdate, startPayment } from "../src/operations/payments";
import { createPromoCode, listPromoCodes, previewPromo, setPromoActive, summarizeByPromoter, updatePromoCode } from "../src/operations/promos";
import { sellAtBoxOffice } from "../src/operations/sales";
import { buyer, createGeneralAdmissionEvent, createPendingOrder } from "./fixtures";

afterAll(() => prisma.$disconnect());

const unique = () => randomCode(6);
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

async function setup() {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 100, types: [{ name: "General", capacity: 100, unitAmount: 10_000 }] });
  const full = await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id }, include: { event: true } });
  const actor = await prisma.staffUser.create({ data: { email: `adm-${unique().toLowerCase()}@prueba.test`, name: "Admin", passwordHash: "!" } });
  return { session, type: types[0]!, eventId: full.eventId, orgId: full.event.organizationId, actorId: actor.id };
}

const code = () => `PRUEBA-${unique()}`;

async function buy(sessionId: string, ticketTypeId: string, n: number, promoCode?: string, quantity = 2) {
  return createPendingOrder({ sessionId, items: [{ ticketTypeId, quantity }], buyer: buyer(n) }, { promoCode });
}

async function pay(orderCode: string) {
  const payment = await startPayment(orderCode, "directo");
  await applyPaymentUpdate({
    paymentId: payment.id,
    provider: "directo",
    providerPaymentId: `directo_${payment.id}`,
    status: "APPROVED",
    providerStatus: "pase_directo",
    amount: payment.amount,
    currency: payment.currency,
  });
}

describe("descuento", () => {
  it("un porcentaje baja el total, queda en la orden y el pago es por el total con descuento", async () => {
    const { session, type, orgId, actorId } = await setup();
    const c = code();
    await createPromoCode(orgId, { code: ` ${c.toLowerCase()} `, discountType: "PERCENT", discountValue: 20 }, actorId);
    const order = await buy(session.id, type.id, 1, c.toLowerCase());
    expect(order).toMatchObject({ subtotalAmount: 20_000, discountAmount: 4_000, totalAmount: 16_000 });
    const redemption = await prisma.promoRedemption.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(redemption.discountAmount).toBe(4_000);
    const payment = await startPayment(order.code, "directo");
    expect(payment.amount).toBe(16_000);
  });

  it("un monto fijo se descuenta de cada entrada", async () => {
    const { session, type, orgId, actorId } = await setup();
    const c = code();
    await createPromoCode(orgId, { code: c, discountType: "FIXED", discountValue: 1_500 }, actorId);
    const order = await buy(session.id, type.id, 2, c, 3);
    expect(order).toMatchObject({ subtotalAmount: 30_000, discountAmount: 4_500, totalAmount: 25_500 });
  });

  it("la vista previa calcula el descuento sin crear ninguna orden", async () => {
    const { session, type, orgId, actorId } = await setup();
    const c = code();
    await createPromoCode(orgId, { code: c, discountType: "PERCENT", discountValue: 10 }, actorId);
    const preview = await previewPromo({ sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 4 }], code: c });
    expect(preview).toMatchObject({ code: c, subtotalAmount: 40_000, discountAmount: 4_000, totalAmount: 36_000 });
    expect(await prisma.order.count({ where: { items: { some: { ticketTypeId: type.id } } } })).toBe(0);
  });

  it("boletería también puede aplicar un código", async () => {
    const { session, type, orgId, actorId } = await setup();
    const c = code();
    await createPromoCode(orgId, { code: c, discountType: "PERCENT", discountValue: 50 }, actorId);
    const order = await sellAtBoxOffice(
      { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 1 }], buyer: { name: "", email: "", document: "7654321" } },
      { staffId: actorId, method: "EFECTIVO", promoCode: c },
    );
    expect(order).toMatchObject({ discountAmount: 5_000, totalAmount: 5_000, status: "PAID" });
  });
});

describe("validez del código", () => {
  it("rechaza uno inventado, inactivo, vencido, que no empieza o de otra organización", async () => {
    const { session, type, orgId, actorId } = await setup();
    const reject = (promoCode: string, message: RegExp) =>
      expect(buy(session.id, type.id, 1, promoCode)).rejects.toMatchObject({ code: "PROMO_INVALID", message: expect.stringMatching(message) });

    await reject("NOEXISTE", /no existe/);
    const inactive = code();
    const promo = await createPromoCode(orgId, { code: inactive, discountType: "PERCENT", discountValue: 10 }, actorId);
    await setPromoActive(orgId, promo.id, false, actorId);
    await reject(inactive, /ya no está activo/);

    const expired = code();
    await createPromoCode(orgId, { code: expired, discountType: "PERCENT", discountValue: 10, startsAt: hours(-48), endsAt: hours(-1) }, actorId);
    await reject(expired, /venció/);
    const future = code();
    await createPromoCode(orgId, { code: future, discountType: "PERCENT", discountValue: 10, startsAt: hours(5) }, actorId);
    await reject(future, /todavía no empieza/);

    // Un evento de otra organización no ve el código de esta.
    const other = await createGeneralAdmissionEvent({ sectionCapacity: 5, types: [{ name: "General", capacity: 5 }] });
    const shared = code();
    await createPromoCode(orgId, { code: shared, discountType: "PERCENT", discountValue: 10 }, actorId);
    await expect(
      createPendingOrder({ sessionId: other.session.id, items: [{ ticketTypeId: other.types[0]!.id, quantity: 1 }], buyer: buyer(9) }, { promoCode: shared }),
    ).rejects.toMatchObject({ code: "PROMO_INVALID" });
  });

  it("un código de un solo evento no vale en otro de la misma organización", async () => {
    const { session, type, orgId, actorId } = await setup();
    const otherEvent = await prisma.event.create({
      data: { organizationId: orgId, slug: `otro-${unique().toLowerCase()}`, title: "Otro evento", status: "PUBLISHED" },
    });
    const scoped = code();
    await createPromoCode(orgId, { code: scoped, discountType: "PERCENT", discountValue: 10, eventId: otherEvent.id }, actorId);
    await expect(buy(session.id, type.id, 1, scoped)).rejects.toMatchObject({ code: "PROMO_INVALID" });
  });

  it("no se suma a la preventa, salvo que el código sea combinable", async () => {
    const { session, type, orgId, actorId } = await setup();
    await prisma.ticketType.update({ where: { id: type.id }, data: { discountPercent: 30, discountEndsAt: hours(24) } });
    const strict = code();
    const combinable = code();
    await createPromoCode(orgId, { code: strict, discountType: "PERCENT", discountValue: 10 }, actorId);
    await createPromoCode(orgId, { code: combinable, discountType: "PERCENT", discountValue: 10, combinableWithPresale: true }, actorId);

    await expect(buy(session.id, type.id, 1, strict)).rejects.toMatchObject({ message: expect.stringMatching(/no aplica/) });
    const order = await buy(session.id, type.id, 2, combinable);
    // Precio de preventa 7.000 ×2 = 14.000; 10% = 1.400.
    expect(order).toMatchObject({ subtotalAmount: 14_000, discountAmount: 1_400, totalAmount: 12_600 });
  });
});

describe("límites de uso", () => {
  it("un máximo de usos total: el siguiente se rechaza y una orden vencida libera el uso", async () => {
    const { session, type, orgId, actorId } = await setup();
    const c = code();
    await createPromoCode(orgId, { code: c, discountType: "PERCENT", discountValue: 10, maxUses: 1 }, actorId);
    const first = await buy(session.id, type.id, 1, c);
    await expect(buy(session.id, type.id, 2, c)).rejects.toMatchObject({ message: expect.stringMatching(/todas las veces/) });

    // La reserva del primero vence sin pagarse: el uso vuelve a estar disponible.
    await prisma.order.update({ where: { id: first.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await expect(buy(session.id, type.id, 3, c)).resolves.toBeTruthy();
  });

  it("un máximo por persona", async () => {
    const { session, type, orgId, actorId } = await setup();
    const c = code();
    await createPromoCode(orgId, { code: c, discountType: "PERCENT", discountValue: 10, maxUsesPerCustomer: 1 }, actorId);
    await buy(session.id, type.id, 1, c);
    await expect(buy(session.id, type.id, 1, c)).rejects.toMatchObject({ message: expect.stringMatching(/Ya usaste/) });
    await expect(buy(session.id, type.id, 2, c)).resolves.toBeTruthy(); // otra persona sí puede
  });

  it("cinco compras a la vez con un solo uso disponible: solo una lo logra", async () => {
    const { session, type, orgId, actorId } = await setup();
    const c = code();
    await createPromoCode(orgId, { code: c, discountType: "PERCENT", discountValue: 10, maxUses: 1 }, actorId);
    const results = await Promise.allSettled([10, 11, 12, 13, 14].map((n) => buy(session.id, type.id, n, c)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.promoRedemption.count({ where: { promoCode: { code: c } } })).toBe(1);
  });
});

describe("promotores (RRPP)", () => {
  it("mide ventas, descuentos y comisión por código y por promotor (solo lo pagado)", async () => {
    const { session, type, orgId, actorId } = await setup();
    const [a, b] = [code(), code()];
    await createPromoCode(orgId, { code: a, discountType: "PERCENT", discountValue: 10, promoterName: "Luis RRPP", commissionPercent: 10 }, actorId);
    await createPromoCode(orgId, { code: b, discountType: "FIXED", discountValue: 1_000, promoterName: "Luis RRPP", commissionPercent: 10 }, actorId);

    const paid1 = await buy(session.id, type.id, 20, a, 2); // 20.000 - 2.000 = 18.000
    const paid2 = await buy(session.id, type.id, 21, b, 1); // 10.000 - 1.000 = 9.000
    await buy(session.id, type.id, 22, a, 1); // reservada, sin pagar: no cuenta como venta
    await pay(paid1.code);
    await pay(paid2.code);

    const rows = await listPromoCodes(orgId);
    const rowA = rows.find((r) => r.code === a)!;
    expect(rowA).toMatchObject({ uses: 2, paidUses: 1, tickets: 2, sales: 18_000, discount: 2_000, commission: 1_800 });
    const [luis] = summarizeByPromoter(rows);
    expect(luis).toMatchObject({ promoter: "Luis RRPP", codes: 2, paidUses: 2, tickets: 3, sales: 27_000, discount: 3_000, commission: 2_700 });
  });

  it("el descuento y el código no se cambian, pero sí los límites y el promotor", async () => {
    const { orgId, actorId } = await setup();
    const promo = await createPromoCode(orgId, { code: code(), discountType: "PERCENT", discountValue: 10 }, actorId);
    const updated = await updatePromoCode(orgId, promo.id, { maxUses: 50, promoterName: "Ana RRPP", commissionPercent: 8 }, actorId);
    expect(updated).toMatchObject({ discountType: "PERCENT", discountValue: 10, code: promo.code, maxUses: 50, promoterName: "Ana RRPP", commissionPercent: 8 });
  });

  it("valida los datos al crear", async () => {
    const { orgId, actorId } = await setup();
    await expect(createPromoCode(orgId, { code: "ab", discountType: "PERCENT", discountValue: 10 }, actorId)).rejects.toMatchObject({ code: "PROMO_INVALID" });
    await expect(createPromoCode(orgId, { code: code(), discountType: "PERCENT", discountValue: 150 }, actorId)).rejects.toMatchObject({ code: "PROMO_INVALID" });
    const c = code();
    await createPromoCode(orgId, { code: c, discountType: "FIXED", discountValue: 500 }, actorId);
    await expect(createPromoCode(orgId, { code: c.toLowerCase(), discountType: "FIXED", discountValue: 500 }, actorId)).rejects.toMatchObject({ code: "DUPLICATE" });
  });
});
