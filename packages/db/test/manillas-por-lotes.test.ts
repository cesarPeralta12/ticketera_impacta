/**
 * Carga masiva de manillas: se leen en un lote y, al confirmar, cada una es una entrada numerada y vinculada que la
 * puerta reconoce.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { createStaffUser } from "../src/operations/accounts";
import { getDoorDownload } from "../src/operations/mobile";
import { linkNfcCard } from "../src/operations/nfc-cards";
import { sellAtBoxOffice } from "../src/operations/sales";
import { updateSalesSettings } from "../src/operations/sales-scope";
import { addWristbandRead, confirmWristbandBatch, createWristbandBatch, discardWristbandBatch, getWristbandBatch, listWristbandBatches, removeWristbandRead, wristbandTypes } from "../src/operations/wristbands";
import { createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

/** Números de serie distintos y válidos (7 bytes). */
const uid = (n: number) => `04${n.toString(16).padStart(12, "0")}`.toUpperCase();

async function setup(capacity = 20) {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: capacity, types: [{ name: "VIP", capacity }] });
  const type = types[0]!;
  await prisma.ticketType.update({ where: { id: type.id }, data: { accessMethods: ["QR", "NFC"] } });
  const full = await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id }, include: { event: true } });
  const orgId = full.event.organizationId;
  const make = async (role: "ADMIN" | "CASHIER" | "OPERATOR") => {
    const user = (await createStaffUser({ organizationId: orgId, name: role, email: `m-${randomCode(8).toLowerCase()}@prueba.test`, password: "Prueba2026!", role }))!;
    return { id: user.id, role, organizationId: orgId };
  };
  const admin = await make("ADMIN");
  const cashier = await make("CASHIER");
  const batch = (extra: { mode?: "VALID_ON_PRINT" | "ACTIVATE_ON_SALE"; prefix?: string; name?: string } = {}) =>
    createWristbandBatch(admin, { sessionId: session.id, ticketTypeId: type.id, name: extra.name ?? "VIP rojas", mode: extra.mode ?? "VALID_ON_PRINT", prefix: extra.prefix ?? "VIP" });
  const read = async (batchId: string, numbers: number[]) => {
    for (const n of numbers) expect(await addWristbandRead(admin, batchId, { uid: uid(n) })).toMatchObject({ ok: true });
  };
  return { session, type, orgId, admin, cashier, make, batch, read };
}

describe("cargar un lote de manillas", () => {
  it("al confirmar crea una entrada por manilla, numerada en el orden de lectura y ya vinculada", async () => {
    const { session, admin, batch, read } = await setup();
    const lot = await batch();
    await read(lot.id, [30, 10, 20]);
    expect(await prisma.ticket.count({ where: { sessionId: session.id } })).toBe(0);

    expect(await confirmWristbandBatch(admin, lot.id)).toEqual({ quantity: 3, prefix: "VIP", firstNumber: 1 });
    const { rows, batch: saved } = await getWristbandBatch(admin, lot.id);
    expect(saved.status).toBe("CONFIRMED");
    expect(rows.map((r) => [r.uid, r.serial])).toEqual([
      [uid(30), "VIP-0001"],
      [uid(10), "VIP-0002"],
      [uid(20), "VIP-0003"],
    ]);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { sessionId: session.id, nfcUid: uid(10) }, include: { order: true } });
    expect(ticket).toMatchObject({ status: "VALID", serial: "VIP-0002", nfcLinkedById: admin.id, order: { buyerName: "Manilla VIP-0002", channel: "PRINTED", totalAmount: 0 } });
    expect(ticket.nfcCard).toMatchObject({ uid: uid(10) });
  });

  it("la puerta la baja y la deja entrar una sola vez", async () => {
    const { session, admin, batch, read } = await setup();
    const lot = await batch();
    await read(lot.id, [1]);
    const before = new Date(Date.now() - 1000);
    await confirmWristbandBatch(admin, lot.id);
    const delta = await getDoorDownload({ sessionId: session.id, since: before });
    const row = delta!.tickets.find((t) => "nfcUid" in t && t.nfcUid === uid(1))!;
    expect(row).toMatchObject({ status: "V", holder: "Manilla VIP-0001" });
    expect((await scanTicket({ sessionId: session.id, raw: row.code, method: "NFC" })).result).toBe("ACCEPTED");
    expect((await scanTicket({ sessionId: session.id, raw: row.code, method: "NFC" })).result).toBe("ALREADY_USED");
  });

  it("«se activa al vender»: no abre la puerta hasta venderse", async () => {
    const { session, admin, batch, read } = await setup();
    const lot = await batch({ mode: "ACTIVATE_ON_SALE" });
    await read(lot.id, [1]);
    await confirmWristbandBatch(admin, lot.id);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { sessionId: session.id } });
    expect((await scanTicket({ sessionId: session.id, raw: ticket.code, method: "NFC" })).result).toBe("NOT_ACTIVATED");
  });

  it("dos lotes con el mismo prefijo siguen la numeración", async () => {
    const { admin, batch, read } = await setup();
    const one = await batch();
    await read(one.id, [1, 2]);
    await confirmWristbandBatch(admin, one.id);
    const two = await batch({ name: "Más VIP" });
    await read(two.id, [3]);
    expect(await confirmWristbandBatch(admin, two.id)).toMatchObject({ firstNumber: 3 });
  });

  it("confirmar dos veces (aun a la vez) no duplica", async () => {
    const { session, admin, batch, read } = await setup();
    const lot = await batch();
    await read(lot.id, [1, 2]);
    const results = await Promise.allSettled([confirmWristbandBatch(admin, lot.id), confirmWristbandBatch(admin, lot.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.ticket.count({ where: { sessionId: session.id } })).toBe(2);
  });
});

describe("lo que se avisa al leer", () => {
  it("repetida en el lote (con su número), en otro lote abierto y ya vinculada a una entrada", async () => {
    const { session, type, admin, batch, read } = await setup();
    const one = await batch();
    await read(one.id, [1, 2]);
    expect(await addWristbandRead(admin, one.id, { uid: uid(2) })).toEqual({ ok: false, reason: "ALREADY_IN_BATCH", detail: "2" });
    const two = await batch({ name: "Otras" });
    expect(await addWristbandRead(admin, two.id, { uid: uid(1) })).toEqual({ ok: false, reason: "IN_OTHER_BATCH", detail: "VIP rojas" });

    const order = await sellAtBoxOffice(
      { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 1 }], buyer: { name: "Venta en caja", email: "caja@prueba.test", document: "7654321" } },
      { staffId: admin.id, method: "EFECTIVO" },
    );
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
    await linkNfcCard(admin, { sessionId: session.id, code: ticket.code, uid: uid(9) });
    expect(await addWristbandRead(admin, two.id, { uid: uid(9) })).toEqual({ ok: false, reason: "UID_IN_USE", detail: ticket.code });
    expect(await addWristbandRead(admin, two.id, { uid: "08112233" })).toEqual({ ok: false, reason: "INVALID_UID" });
  });

  it("no pasa del cupo del tipo", async () => {
    const { admin, batch, read, session } = await setup(2);
    const lot = await batch();
    await read(lot.id, [1, 2]);
    expect(await addWristbandRead(admin, lot.id, { uid: uid(3) })).toEqual({ ok: false, reason: "FULL" });
    expect((await wristbandTypes(session.id))[0]!.available).toBe(2);
  });

  it("si el cupo se vendió entretanto, no se crea ninguna", async () => {
    const { session, type, admin, batch, read } = await setup(2);
    const lot = await batch();
    await read(lot.id, [1, 2]);
    await sellAtBoxOffice(
      { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 1 }], buyer: { name: "Venta en caja", email: "caja@prueba.test", document: "7654321" } },
      { staffId: admin.id, method: "EFECTIVO" },
    );
    await expect(confirmWristbandBatch(admin, lot.id)).rejects.toMatchObject({ code: "SOLD_OUT" });
    expect(await prisma.ticket.count({ where: { sessionId: session.id } })).toBe(1);
    expect((await getWristbandBatch(admin, lot.id)).batch.status).toBe("OPEN");
  });

  it("si una manilla se vinculó por otro lado, dice cuál y se puede quitar y confirmar", async () => {
    const { session, type, admin, batch, read } = await setup();
    const lot = await batch();
    await read(lot.id, [1, 2]);
    const order = await sellAtBoxOffice(
      { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 1 }], buyer: { name: "Venta en caja", email: "caja@prueba.test", document: "7654321" } },
      { staffId: admin.id, method: "EFECTIVO" },
    );
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
    await linkNfcCard(admin, { sessionId: session.id, code: ticket.code, uid: uid(2) });
    await expect(confirmWristbandBatch(admin, lot.id)).rejects.toThrow("n.º 2");
    const { rows } = await getWristbandBatch(admin, lot.id);
    await removeWristbandRead(admin, lot.id, rows[1]!.id);
    expect(await confirmWristbandBatch(admin, lot.id)).toMatchObject({ quantity: 1 });
  });

  it("descartar libera las manillas", async () => {
    const { admin, batch, read, session } = await setup();
    const one = await batch();
    await read(one.id, [1]);
    await discardWristbandBatch(admin, one.id);
    expect(await listWristbandBatches(admin, session.id)).toEqual([]);
    expect(await addWristbandRead(admin, one.id, { uid: uid(2) })).toEqual({ ok: false, reason: "BATCH_CLOSED" });
    const two = await batch();
    await read(two.id, [1]);
  });
});

describe("quién puede", () => {
  it("un cajero habilitado lee manillas, pero no crea, confirma ni descarta lotes", async () => {
    const { session, type, orgId, cashier, batch } = await setup();
    const lot = await batch();
    await expect(addWristbandRead(cashier, lot.id, { uid: uid(1) })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await updateSalesSettings({ organizationId: orgId, userId: cashier.id, canRedeemNfc: true });
    expect(await addWristbandRead(cashier, lot.id, { uid: uid(1) })).toMatchObject({ ok: true, count: 1 });
    await expect(createWristbandBatch(cashier, { sessionId: session.id, ticketTypeId: type.id, name: "Mío", mode: "VALID_ON_PRINT" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await expect(confirmWristbandBatch(cashier, lot.id)).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await expect(discardWristbandBatch(cashier, lot.id)).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("un portero no, y otra organización no ve el lote", async () => {
    const mine = await setup();
    const other = await setup();
    const lot = await mine.batch();
    const operator = await mine.make("OPERATOR");
    await expect(addWristbandRead(operator, lot.id, { uid: uid(1) })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await expect(getWristbandBatch(other.admin, lot.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(confirmWristbandBatch(other.admin, lot.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("un tipo sin NFC no sirve para manillas", async () => {
    const { session, type, admin } = await setup();
    await prisma.ticketType.update({ where: { id: type.id }, data: { accessMethods: ["QR"] } });
    await expect(createWristbandBatch(admin, { sessionId: session.id, ticketTypeId: type.id, name: "VIP", mode: "VALID_ON_PRINT" })).rejects.toMatchObject({ code: "INVALID_ITEMS" });
  });
});
