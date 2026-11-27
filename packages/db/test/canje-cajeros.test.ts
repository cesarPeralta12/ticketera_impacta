/**
 * Canje por cajeros: un cajero habilitado vincula tarjetas NFC desde el panel, solo en las funciones que puede vender.
 * Y qué entrada corresponde a lo que se lee en el mostrador.
 */
import { afterAll, describe, expect, it } from "vitest";
import { deriveTicketKey, randomCode, signDynamicPayload, signTicketPayload } from "@ticketera/core";
import { prisma } from "../src/client";
import { createStaffUser } from "../src/operations/accounts";
import { linkNfcCard } from "../src/operations/nfc-cards";
import { canRedeemNfc, findTicketForRedeem, redeemSessions } from "../src/operations/nfc-redeem";
import { sellAtBoxOffice } from "../src/operations/sales";
import { setDoorRedeemNfc, setSalesAssignment, updateSalesSettings } from "../src/operations/sales-scope";
import { createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

const UID = "047F8C520F7A80";

async function setup(opts: { enabled?: boolean } = {}) {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 20, types: [{ name: "General", capacity: 20 }] });
  const type = types[0]!;
  await prisma.ticketType.update({ where: { id: type.id }, data: { accessMethods: ["QR", "NFC"] } });
  const full = await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id }, include: { event: true } });
  const orgId = full.event.organizationId;
  const make = async (role: "ADMIN" | "CASHIER" | "OPERATOR") => {
    const user = (await createStaffUser({ organizationId: orgId, name: role, email: `c-${randomCode(8).toLowerCase()}@prueba.test`, password: "Prueba2026!", role }))!;
    return { id: user.id, role, organizationId: orgId };
  };
  const admin = await make("ADMIN");
  const cashier = await make("CASHIER");
  const operator = await make("OPERATOR");
  if (opts.enabled !== false) await updateSalesSettings({ organizationId: orgId, userId: cashier.id, canRedeemNfc: true });
  const sell = async (quantity = 1) => {
    const order = await sellAtBoxOffice(
      { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity }], buyer: { name: "Venta en caja", email: "caja@prueba.test", document: "7654321" } },
      { staffId: admin.id, method: "EFECTIVO" },
    );
    return prisma.ticket.findMany({ where: { orderId: order.id } });
  };
  return { session, type, eventId: full.eventId, orgId, admin, cashier, operator, sell };
}

describe("quién puede canjear", () => {
  it("un cajero sin habilitar no puede; habilitado, sí; y se le puede quitar", async () => {
    const { session, orgId, cashier, sell } = await setup({ enabled: false });
    const [ticket] = await sell();
    expect(await canRedeemNfc(cashier)).toBe(false);
    expect(await redeemSessions(cashier)).toEqual([]);
    expect(await findTicketForRedeem(cashier, session.id, ticket!.code)).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await linkNfcCard(cashier, { sessionId: session.id, code: ticket!.code, uid: UID })).toEqual({ ok: false, reason: "FORBIDDEN" });

    await updateSalesSettings({ organizationId: orgId, userId: cashier.id, canRedeemNfc: true });
    expect((await redeemSessions(cashier)).map((s) => s.id)).toContain(session.id);
    expect((await linkNfcCard(cashier, { sessionId: session.id, code: ticket!.code, uid: UID })).ok).toBe(true);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket!.id } });
    expect(row.nfcLinkedById).toBe(cashier.id);

    await updateSalesSettings({ organizationId: orgId, userId: cashier.id, canRedeemNfc: false });
    expect(await canRedeemNfc(cashier)).toBe(false);
  });

  it("guardar otros ajustes del cajero no le quita el permiso", async () => {
    const { orgId, cashier } = await setup();
    await updateSalesSettings({ organizationId: orgId, userId: cashier.id, posMethods: ["EFECTIVO"] });
    expect(await canRedeemNfc(cashier)).toBe(true);
  });

  it("con «solo lo asignado», únicamente en sus funciones", async () => {
    const { session, eventId, orgId, cashier, sell } = await setup();
    const [ticket] = await sell();
    await updateSalesSettings({ organizationId: orgId, userId: cashier.id, salesScope: "ASSIGNED" });
    expect(await redeemSessions(cashier)).toEqual([]);
    expect(await linkNfcCard(cashier, { sessionId: session.id, code: ticket!.code, uid: UID })).toEqual({ ok: false, reason: "FORBIDDEN" });

    await setSalesAssignment(prisma, { organizationId: orgId, userId: cashier.id, eventId });
    expect((await redeemSessions(cashier)).map((s) => s.id)).toEqual([session.id]);
    expect((await linkNfcCard(cashier, { sessionId: session.id, code: ticket!.code, uid: UID })).ok).toBe(true);
  });

  it("un portero habilitado, solo en sus funciones asignadas; y se le puede quitar", async () => {
    const { session, orgId, cashier, operator, sell } = await setup();
    const [ticket] = await sell();
    const input = { sessionId: session.id, code: ticket!.code, uid: UID };
    expect(await canRedeemNfc(operator)).toBe(false);

    await setDoorRedeemNfc({ organizationId: orgId, userId: operator.id, canRedeemNfc: true });
    expect(await redeemSessions(operator)).toEqual([]);
    expect(await linkNfcCard(operator, input)).toEqual({ ok: false, reason: "FORBIDDEN" });

    await prisma.doorAssignment.create({ data: { userId: operator.id, sessionId: session.id } });
    expect((await redeemSessions(operator)).map((s) => s.id)).toEqual([session.id]);
    expect((await linkNfcCard(operator, input)).ok).toBe(true);

    await setDoorRedeemNfc({ organizationId: orgId, userId: operator.id, canRedeemNfc: false });
    expect(await linkNfcCard(operator, input)).toEqual({ ok: false, reason: "FORBIDDEN" });
    // El permiso de portero no sirve para cambiar la cuenta de un cajero.
    await expect(setDoorRedeemNfc({ organizationId: orgId, userId: cashier.id, canRedeemNfc: false })).rejects.toThrow();
  });

  it("no en la función de otra organización", async () => {
    const mine = await setup();
    const other = await setup();
    const [ticket] = await other.sell();
    expect(await findTicketForRedeem(mine.cashier, other.session.id, ticket!.code)).toEqual({ ok: false, reason: "FORBIDDEN" });
    // Y su código leído en una función propia no revela nada.
    expect(await findTicketForRedeem(mine.cashier, mine.session.id, ticket!.code)).toEqual({ ok: false, reason: "NOT_FOUND" });
  });
});

describe("la entrada que se lee en el mostrador", () => {
  it("la reconoce por su QR firmado o por el código escrito", async () => {
    const { session, cashier, sell } = await setup();
    const [ticket] = await sell();
    const qr = await signTicketPayload(ticket!.code, process.env.TICKET_QR_SECRET!);
    for (const raw of [qr, ticket!.code, `${ticket!.code.slice(0, 5)}-${ticket!.code.slice(5)}`.toLowerCase()]) {
      expect(await findTicketForRedeem(cashier, session.id, raw)).toMatchObject({ ok: true, ticket: { code: ticket!.code, document: "7654321", currentUid: null, notice: null } });
    }
  });

  it("muestra la tarjeta que ya tiene", async () => {
    const { session, cashier, sell } = await setup();
    const [ticket] = await sell();
    await linkNfcCard(cashier, { sessionId: session.id, code: ticket!.code, uid: UID });
    expect(await findTicketForRedeem(cashier, session.id, ticket!.code)).toMatchObject({ ok: true, ticket: { currentUid: UID } });
  });

  it("explica por qué no se puede", async () => {
    const { session, type, cashier, sell } = await setup();
    const [a, b] = await sell(2);
    await prisma.ticket.update({ where: { id: a!.id }, data: { status: "CANCELLED" } });
    await prisma.ticket.update({ where: { id: b!.id }, data: { status: "USED" } });
    expect(await findTicketForRedeem(cashier, session.id, a!.code)).toEqual({ ok: false, reason: "CANCELLED" });
    expect(await findTicketForRedeem(cashier, session.id, b!.code)).toEqual({ ok: false, reason: "USED" });
    expect(await findTicketForRedeem(cashier, session.id, "ZZZZZZZZZZ")).toEqual({ ok: false, reason: "NOT_FOUND" });
    const [c] = await sell();
    await prisma.ticketType.update({ where: { id: type.id }, data: { accessMethods: ["QR"] } });
    expect(await findTicketForRedeem(cashier, session.id, c!.code)).toEqual({ ok: false, reason: "NFC_NOT_ENABLED" });
  });

  it("una entrada de QR dinámico exige su QR vigente", async () => {
    const { session, type, cashier, sell } = await setup();
    const [ticket] = await sell();
    await prisma.ticketType.update({ where: { id: type.id }, data: { qrMode: "DYNAMIC" } });
    const key = await deriveTicketKey(process.env.TICKET_QR_SECRET!, ticket!.code);
    expect(await findTicketForRedeem(cashier, session.id, ticket!.code)).toEqual({ ok: false, reason: "QR_NOT_VALID" });
    const old = await signDynamicPayload(key, ticket!.code, Date.now() - 10 * 60_000);
    expect(await findTicketForRedeem(cashier, session.id, old)).toEqual({ ok: false, reason: "QR_NOT_VALID" });
    const live = await signDynamicPayload(key, ticket!.code, Date.now());
    expect((await findTicketForRedeem(cashier, session.id, live)).ok).toBe(true);
  });
});
