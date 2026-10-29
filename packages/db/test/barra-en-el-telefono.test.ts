/**
 * Modo Barra de la app: la cuenta de barra solo ve las noches asignadas, descarga los vales, los lee una vez
 * (también sin conexión) y no recibe nada de puerta.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { createStaffUser } from "../src/operations/accounts";
import { getBarDownload, getBarNights, submitBarReads } from "../src/operations/bar";
import { canControlSession, getDoorAssignments, type DoorStaff } from "../src/operations/mobile";
import { redeemVoucher } from "../src/operations/nightlife";
import { addSessionSeller } from "../src/operations/sales-scope";
import { applyPaymentUpdate, startPayment } from "../src/operations/payments";
import { buyer, createGeneralAdmissionEvent, createPendingOrder } from "./fixtures";

afterAll(() => prisma.$disconnect());

const unique = () => randomCode(6).toLowerCase();

async function setup() {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 50, types: [{ name: "Mesa VIP", capacity: 10, unitAmount: 50_000 }] });
  const full = await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id }, include: { event: true } });
  await prisma.event.update({ where: { id: full.eventId }, data: { status: "PUBLISHED" } });
  await prisma.eventSession.update({ where: { id: session.id }, data: { startsAt: new Date(Date.now() + 3_600_000) } });
  await prisma.ticketType.update({ where: { id: types[0]!.id }, data: { kind: "TABLE", peoplePerUnit: 4, consumptionAmount: 20_000 } });
  const orgId = full.event.organizationId;
  const staffOf = async (role: "BAR" | "ADMIN" | "OPERATOR", name: string): Promise<DoorStaff> => {
    const user = (await createStaffUser({ organizationId: orgId, name, email: `${role.toLowerCase()}-${unique()}@prueba.test`, password: "Cuenta2026!", role, salesScope: role === "BAR" ? "ASSIGNED" : undefined }))!;
    return { id: user.id, name, email: user.email, role, organizationId: orgId };
  };
  return { session, ticketTypeId: types[0]!.id, orgId, staffOf };
}

async function buyTable(sessionId: string, ticketTypeId: string, n: number) {
  const order = await createPendingOrder({ sessionId, items: [{ ticketTypeId, quantity: 1 }], buyer: buyer(n) });
  const payment = await startPayment(order.code, "directo");
  await applyPaymentUpdate({ paymentId: payment.id, provider: "directo", providerPaymentId: `directo_${payment.id}`, status: "APPROVED", providerStatus: "pase_directo", amount: payment.amount, currency: payment.currency });
  return prisma.consumptionCredit.findFirstOrThrow({ where: { orderId: order.id } });
}

describe("barra en el teléfono", () => {
  it("la cuenta de barra solo ve las noches que tiene asignadas", async () => {
    const { session, ticketTypeId, orgId, staffOf } = await setup();
    await buyTable(session.id, ticketTypeId, 1);
    const bar = await staffOf("BAR", "Barra");
    expect(await getBarNights(bar)).toEqual([]); // sin asignar
    expect(await getBarDownload(bar, session.id)).toBeNull();

    await addSessionSeller({ organizationId: orgId, userId: bar.id, sessionId: session.id });
    const nights = await getBarNights(bar);
    expect(nights.map((n) => n.sessionId)).toEqual([session.id]);
    expect(nights[0]).toMatchObject({ vouchers: 1, read: 0 });
    expect((await getBarDownload(bar, session.id))?.vouchers).toHaveLength(1);

    // Un administrador ve todas; un portero no usa la barra.
    expect((await getBarNights(await staffOf("ADMIN", "Admin"))).map((n) => n.sessionId)).toContain(session.id);
    expect(await getBarNights(await staffOf("OPERATOR", "Portero"))).toEqual([]);
  });

  it("la cuenta de barra no recibe funciones ni datos de puerta", async () => {
    const { session, orgId, staffOf } = await setup();
    const bar = await staffOf("BAR", "Barra");
    await addSessionSeller({ organizationId: orgId, userId: bar.id, sessionId: session.id });
    expect(await getDoorAssignments(bar)).toEqual([]);
    expect(await canControlSession(bar, session.id)).toBeNull();
  });

  it("lee sin conexión y sincroniza en orden: el segundo teléfono recibe «ya leído» con quién y cuándo", async () => {
    const { session, ticketTypeId, orgId, staffOf } = await setup();
    const credit = await buyTable(session.id, ticketTypeId, 2);
    const one = await staffOf("BAR", "Barra 1");
    const two = await staffOf("BAR", "Barra 2");
    for (const bar of [one, two]) await addSessionSeller({ organizationId: orgId, userId: bar.id, sessionId: session.id });

    const early = new Date(Date.now() - 10 * 60_000).toISOString();
    const late = new Date(Date.now() - 5 * 60_000).toISOString();
    // El teléfono 2 sincroniza primero, pero el teléfono 1 leyó antes: aun así, gana quien llegó al servidor primero.
    const second = await submitBarReads(two, session.id, [{ id: "lectura-2", code: credit.code, readAt: late, note: "mesa 3" }]);
    expect(second).toMatchObject([{ result: "REDEEMED", voucher: { redeemedBy: "Barra 2", note: "mesa 3" } }]);
    const first = await submitBarReads(one, session.id, [{ id: "lectura-1", code: credit.code, readAt: early }]);
    expect(first).toMatchObject([{ result: "ALREADY_REDEEMED", voucher: { redeemedBy: "Barra 2" } }]);

    // Reenviar el mismo lote no duplica nada.
    await submitBarReads(two, session.id, [{ id: "lectura-2", code: credit.code, readAt: late }]);
    expect(await prisma.consumptionRedemption.count({ where: { creditId: credit.id } })).toBe(1);
    expect((await getBarNights(one))[0]).toMatchObject({ vouchers: 1, read: 1 });
  });

  it("una noche no asignada no se puede leer, y los códigos falsos se rechazan sin romper el lote", async () => {
    const { session, ticketTypeId, orgId, staffOf } = await setup();
    const credit = await buyTable(session.id, ticketTypeId, 3);
    const bar = await staffOf("BAR", "Barra");
    expect(await submitBarReads(bar, session.id, [{ id: "x1", code: credit.code, readAt: new Date().toISOString() }])).toBeNull();
    await addSessionSeller({ organizationId: orgId, userId: bar.id, sessionId: session.id });
    const results = await submitBarReads(bar, session.id, [
      { id: "malo", code: "NOEXISTE00", readAt: new Date().toISOString() },
      { id: "bueno", code: credit.code, readAt: new Date().toISOString() },
    ]);
    expect(results?.map((r) => r.result).toSorted()).toEqual(["REDEEMED", "REJECTED"]);
    // Un administrador también puede leer desde el panel.
    expect(await redeemVoucher({ raw: credit.code, sessionId: session.id, staffId: bar.id })).toMatchObject({ status: "ALREADY_REDEEMED" });
  });
});
