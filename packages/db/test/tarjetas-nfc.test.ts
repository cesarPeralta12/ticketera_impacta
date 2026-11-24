/**
 * Tarjetas y manillas NFC: el canje vincula el número de serie (UID) a una entrada, la puerta lo baja en la descarga y,
 * al leer la tarjeta, valida con el código de la entrada. Nada se escribe en la tarjeta.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { createStaffUser } from "../src/operations/accounts";
import { authenticateDevice, getDoorDownload, startDeviceSession } from "../src/operations/mobile";
import { linkNfcCard } from "../src/operations/nfc-cards";
import { sellAtBoxOffice } from "../src/operations/sales";
import { createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

const PASSWORD = "Prueba2026!";
const UID = "04:7F:8C:52:0F:7A:80";
const UID_CLEAN = "047F8C520F7A80";
const CARD = { type: "ISO 14443-3A", model: "Mifare Ultralight", tech: ["NfcA", "MifareUltralight", "Ndef"], atqa: "0044", sak: "00" };

async function setup(methods: ("QR" | "BARCODE" | "NFC")[] = ["BARCODE", "NFC"]) {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 20, types: [{ name: "General", capacity: 20 }] });
  await prisma.ticketType.update({ where: { id: types[0]!.id }, data: { accessMethods: methods } });
  const full = await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id }, include: { event: true } });
  const orgId = full.event.organizationId;
  const email = () => `n-${randomCode(6).toLowerCase()}@prueba.test`;
  const admin = (await createStaffUser({ organizationId: orgId, name: "Admin", email: email(), password: PASSWORD, role: "ADMIN" }))!;
  const operator = (await createStaffUser({ organizationId: orgId, name: "Portero", email: email(), password: PASSWORD, role: "OPERATOR" }))!;
  const staffOf = async (user: { email: string }) => {
    const result = await startDeviceSession({ email: user.email, password: PASSWORD, deviceId: `dev-${randomCode(6)}`, deviceName: "Moto G" });
    if ("error" in result) throw new Error(result.error);
    return (await authenticateDevice(result.token))!;
  };
  return { session, type: types[0]!, orgId, admin, operator, adminStaff: await staffOf(admin), operatorStaff: await staffOf(operator) };
}

async function sell(sessionId: string, ticketTypeId: string, staffId: string, quantity = 1) {
  const order = await sellAtBoxOffice(
    { sessionId, items: [{ ticketTypeId, quantity }], buyer: { name: "Venta en caja", email: "caja@prueba.test", document: "7654321" } },
    { staffId, method: "EFECTIVO" },
  );
  return prisma.ticket.findMany({ where: { orderId: order.id } });
}

describe("vincular una tarjeta NFC a una entrada", () => {
  it("guarda el UID limpio y la huella, y deja constancia", async () => {
    const { session, type, admin, adminStaff } = await setup();
    const [ticket] = await sell(session.id, type.id, admin.id);
    const result = await linkNfcCard(adminStaff, { sessionId: session.id, code: ticket!.code, uid: UID, card: CARD });
    expect(result).toMatchObject({ ok: true, uid: UID_CLEAN, replaced: false, previousUid: null });

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket!.id } });
    expect(row.nfcUid).toBe(UID_CLEAN);
    expect(row.nfcCard).toMatchObject({ uid: UID_CLEAN, model: "Mifare Ultralight", tech: ["NfcA", "MifareUltralight", "Ndef"] });
    expect(row.nfcLinkedAt).not.toBeNull();
    expect(row.nfcLinkedById).toBe(admin.id);
    const audit = await prisma.auditLog.findFirst({ where: { action: "ticket.nfc_linked", entityId: ticket!.id } });
    expect(audit).not.toBeNull();
  });

  it("la descarga lleva el UID de la tarjeta y el cambio llega también en la descarga incremental", async () => {
    const { session, type, admin, adminStaff } = await setup();
    const [ticket] = await sell(session.id, type.id, admin.id);
    const before = new Date();
    await linkNfcCard(adminStaff, { sessionId: session.id, code: ticket!.code, uid: UID });

    const full = await getDoorDownload({ sessionId: session.id });
    expect(full!.tickets.find((t) => t.code === ticket!.code)).toMatchObject({ nfcUid: UID_CLEAN });

    const delta = await getDoorDownload({ sessionId: session.id, since: new Date(before.getTime() - 1000) });
    expect(delta!.tickets.find((t) => t.code === ticket!.code)).toMatchObject({ nfcUid: UID_CLEAN });
  });

  it("una entrada sin tarjeta no lleva el campo", async () => {
    const { session, type, admin } = await setup();
    const [ticket] = await sell(session.id, type.id, admin.id);
    const full = await getDoorDownload({ sessionId: session.id });
    expect(full!.tickets.find((t) => t.code === ticket!.code)).not.toHaveProperty("nfcUid");
  });

  it("la puerta valida con el código de la entrada leída por NFC, una sola vez", async () => {
    const { session, type, admin, adminStaff } = await setup();
    const [ticket] = await sell(session.id, type.id, admin.id);
    await linkNfcCard(adminStaff, { sessionId: session.id, code: ticket!.code, uid: UID });
    expect((await scanTicket({ sessionId: session.id, raw: ticket!.code, method: "NFC" })).result).toBe("ACCEPTED");
    expect((await scanTicket({ sessionId: session.id, raw: ticket!.code, method: "NFC" })).result).toBe("ALREADY_USED");
  });

  it("una tarjeta no se pisa si ya es de otra entrada", async () => {
    const { session, type, admin, adminStaff } = await setup();
    const [a, b] = await sell(session.id, type.id, admin.id, 2);
    await linkNfcCard(adminStaff, { sessionId: session.id, code: a!.code, uid: UID });
    const result = await linkNfcCard(adminStaff, { sessionId: session.id, code: b!.code, uid: "04-7f-8c-52-0f-7a-80" });
    expect(result).toEqual({ ok: false, reason: "UID_IN_USE", detail: a!.code });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: b!.id } })).nfcUid).toBeNull();
  });

  it("la misma tarjeta en otra función sí puede usarse (la clave es por función)", async () => {
    const one = await setup();
    const two = await setup();
    const [a] = await sell(one.session.id, one.type.id, one.admin.id);
    const [b] = await sell(two.session.id, two.type.id, two.admin.id);
    expect((await linkNfcCard(one.adminStaff, { sessionId: one.session.id, code: a!.code, uid: UID })).ok).toBe(true);
    expect((await linkNfcCard(two.adminStaff, { sessionId: two.session.id, code: b!.code, uid: UID })).ok).toBe(true);
  });

  it("una entrada con tarjeta no cambia sin pedirlo; con 'replace' la tarjeta perdida queda libre", async () => {
    const { session, type, admin, adminStaff } = await setup();
    const [a, b] = await sell(session.id, type.id, admin.id, 2);
    await linkNfcCard(adminStaff, { sessionId: session.id, code: a!.code, uid: UID });

    const second = await linkNfcCard(adminStaff, { sessionId: session.id, code: a!.code, uid: "A1:B2:C3:D4" });
    expect(second).toEqual({ ok: false, reason: "ALREADY_LINKED", detail: UID_CLEAN });

    const swapped = await linkNfcCard(adminStaff, { sessionId: session.id, code: a!.code, uid: "A1:B2:C3:D4", replace: true });
    expect(swapped).toMatchObject({ ok: true, replaced: true, previousUid: UID_CLEAN, uid: "A1B2C3D4" });
    expect(await prisma.auditLog.findFirst({ where: { action: "ticket.nfc_replaced", entityId: a!.id } })).not.toBeNull();

    // La tarjeta perdida quedó libre: otra entrada puede usarla.
    expect((await linkNfcCard(adminStaff, { sessionId: session.id, code: b!.code, uid: UID })).ok).toBe(true);
  });

  it("vincular la misma tarjeta otra vez a la misma entrada no es un error", async () => {
    const { session, type, admin, adminStaff } = await setup();
    const [a] = await sell(session.id, type.id, admin.id);
    await linkNfcCard(adminStaff, { sessionId: session.id, code: a!.code, uid: UID });
    expect(await linkNfcCard(adminStaff, { sessionId: session.id, code: a!.code, uid: UID, card: CARD })).toMatchObject({ ok: true, replaced: false });
  });

  it("acepta el código escrito con guion y en minúsculas", async () => {
    const { session, type, admin, adminStaff } = await setup();
    const [a] = await sell(session.id, type.id, admin.id);
    const typed = `${a!.code.slice(0, 5)}-${a!.code.slice(5)}`.toLowerCase();
    expect((await linkNfcCard(adminStaff, { sessionId: session.id, code: typed, uid: UID })).ok).toBe(true);
  });
});

describe("lo que no se puede vincular", () => {
  it("un tipo de entrada sin NFC activado: la puerta rechazaría la tarjeta", async () => {
    const { session, type, admin, adminStaff } = await setup(["QR"]);
    const [a] = await sell(session.id, type.id, admin.id);
    expect(await linkNfcCard(adminStaff, { sessionId: session.id, code: a!.code, uid: UID })).toEqual({ ok: false, reason: "NFC_NOT_ENABLED" });
  });

  it("una entrada anulada o ya usada", async () => {
    const { session, type, admin, adminStaff } = await setup();
    const [a, b] = await sell(session.id, type.id, admin.id, 2);
    await prisma.ticket.update({ where: { id: a!.id }, data: { status: "CANCELLED" } });
    await scanTicket({ sessionId: session.id, raw: b!.code, method: "NFC" });
    expect(await linkNfcCard(adminStaff, { sessionId: session.id, code: a!.code, uid: UID })).toEqual({ ok: false, reason: "TICKET_INACTIVE" });
    expect(await linkNfcCard(adminStaff, { sessionId: session.id, code: b!.code, uid: UID })).toEqual({ ok: false, reason: "TICKET_INACTIVE" });
  });

  it("un código que no existe en esa función", async () => {
    const { session, adminStaff } = await setup();
    expect(await linkNfcCard(adminStaff, { sessionId: session.id, code: "ZZZZZZZZZZ", uid: UID })).toEqual({ ok: false, reason: "TICKET_NOT_FOUND" });
  });

  it("un número de serie que no identifica (aleatorio, corto, ceros)", async () => {
    const { session, type, admin, adminStaff } = await setup();
    const [a] = await sell(session.id, type.id, admin.id);
    for (const uid of ["08:11:22:33", "04:7F:8C", "00:00:00:00", "no-es-hex", ""]) {
      expect(await linkNfcCard(adminStaff, { sessionId: session.id, code: a!.code, uid })).toEqual({ ok: false, reason: "INVALID_UID" });
    }
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: a!.id } })).nfcUid).toBeNull();
  });

  it("un portero no vincula tarjetas", async () => {
    const { session, type, admin, operatorStaff } = await setup();
    const [a] = await sell(session.id, type.id, admin.id);
    expect(await linkNfcCard(operatorStaff, { sessionId: session.id, code: a!.code, uid: UID })).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("una función de otra organización", async () => {
    const mine = await setup();
    const other = await setup();
    const [a] = await sell(other.session.id, other.type.id, other.admin.id);
    expect(await linkNfcCard(mine.adminStaff, { sessionId: other.session.id, code: a!.code, uid: UID })).toEqual({ ok: false, reason: "FORBIDDEN" });
  });
});
