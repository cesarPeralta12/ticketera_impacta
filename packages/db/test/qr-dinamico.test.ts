/**
 * QR dinámico en puerta: solo vale con una prueba vigente. Una captura vieja se rechaza, el código estático
 * no sirve, el respaldo escrito exige el OTP, y las lecturas sin conexión se vuelven a verificar al sincronizar.
 */
import { afterAll, describe, expect, it } from "vitest";
import { STEP_SECONDS, deriveTicketKey, dynamicOtp, fromBase64Url, signDynamicPayload, signTicketPayload, stepAt, verifyDynamicPayload, parseDynamicPayload } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { createStaffUser } from "../src/operations/accounts";
import { getDoorDownload } from "../src/operations/mobile";
import { sellAtBoxOffice } from "../src/operations/sales";
import { createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

const SECRET = process.env.TICKET_QR_SECRET!;
const STEP_MS = STEP_SECONDS * 1000;

async function setup(mode: "STATIC" | "DYNAMIC" = "DYNAMIC") {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 20, types: [{ name: "VIP", capacity: 10 }] });
  const full = await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id }, include: { event: true } });
  const cashier = (await createStaffUser({ organizationId: full.event.organizationId, name: "Caja", email: `c-${Math.random().toString(36).slice(2, 8)}@prueba.test`, password: "Prueba2026!", role: "CASHIER" }))!;
  const order = await sellAtBoxOffice(
    { sessionId: session.id, items: [{ ticketTypeId: types[0]!.id, quantity: 1 }], buyer: { name: "Ana", email: "ana@prueba.test", document: "7654321" } },
    { staffId: cashier.id, method: "EFECTIVO" },
  );
  const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
  // La boletería vende entradas estáticas; el tipo pasa a dinámico como si se hubiera vendido online.
  await prisma.ticketType.update({ where: { id: types[0]!.id }, data: { qrMode: mode } });
  const key = await deriveTicketKey(SECRET, ticket.code);
  return { session, ticket, key, sessionId: session.id };
}

const scan = (sessionId: string, raw: string, extra: Partial<Parameters<typeof scanTicket>[0]> = {}) =>
  scanTicket({ sessionId, raw, method: "QR", ...extra });

describe("lectura de QR dinámico", () => {
  it("un QR vigente entra y el mismo QR no entra dos veces", async () => {
    const { sessionId, ticket, key } = await setup();
    const qr = await signDynamicPayload(key, ticket.code, Date.now());
    expect((await scan(sessionId, qr)).result).toBe("ACCEPTED");
    expect((await scan(sessionId, qr)).result).toBe("ALREADY_USED");
  });

  it("acepta el paso anterior y el siguiente (relojes desajustados)", async () => {
    const a = await setup();
    expect((await scan(a.sessionId, await signDynamicPayload(a.key, a.ticket.code, Date.now() - STEP_MS))).result).toBe("ACCEPTED");
    const b = await setup();
    expect((await scan(b.sessionId, await signDynamicPayload(b.key, b.ticket.code, Date.now() + STEP_MS))).result).toBe("ACCEPTED");
  });

  it("una captura vieja se rechaza como QR vencido y la entrada sigue válida", async () => {
    const { sessionId, ticket, key } = await setup();
    const stale = await signDynamicPayload(key, ticket.code, Date.now() - 5 * 60_000);
    expect((await scan(sessionId, stale)).result).toBe("QR_EXPIRED");
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("VALID");
    // El dueño, con su QR vivo, entra normalmente.
    expect((await scan(sessionId, await signDynamicPayload(key, ticket.code, Date.now()))).result).toBe("ACCEPTED");
  });

  it("el código estático (TK1, impreso o de barras) no sirve en una entrada dinámica", async () => {
    const { sessionId, ticket } = await setup();
    const tk1 = await signTicketPayload(ticket.code, SECRET);
    expect((await scan(sessionId, tk1)).result).toBe("STATIC_NOT_ALLOWED");
    expect((await scan(sessionId, ticket.code, { method: "BARCODE" })).result).toBe("STATIC_NOT_ALLOWED");
    expect((await scan(sessionId, ticket.code, { method: "MANUAL" })).result).toBe("STATIC_NOT_ALLOWED");
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("VALID");
  });

  it("una prueba falsificada o de otra entrada es inválida", async () => {
    const a = await setup();
    const b = await setup();
    const forged = `TK2.${a.ticket.code}.${stepAt(Date.now()).toString(36)}.AAAAAAAAAAA`;
    expect((await scan(a.sessionId, forged)).result).toBe("INVALID");
    // Prueba de la entrada B pegada en la A.
    const proofB = parseDynamicPayload(await signDynamicPayload(b.key, b.ticket.code, Date.now()))!.proof;
    expect((await scan(a.sessionId, `TK2.${a.ticket.code}.${stepAt(Date.now()).toString(36)}.${proofB}`)).result).toBe("INVALID");
    // "Rejuvenecer" una captura cambiando solo el paso.
    const old = await signDynamicPayload(a.key, a.ticket.code, Date.now() - 10 * 60_000);
    const [, code, , proof] = old.split(".");
    expect((await scan(a.sessionId, `TK2.${code}.${stepAt(Date.now()).toString(36)}.${proof}`)).result).toBe("INVALID");
  });

  it("un TK2 en una entrada estática no existe: es inválido", async () => {
    const { sessionId, ticket, key } = await setup("STATIC");
    expect((await scan(sessionId, await signDynamicPayload(key, ticket.code, Date.now()))).result).toBe("INVALID");
    // Y la entrada estática sigue entrando como siempre.
    expect((await scan(sessionId, await signTicketPayload(ticket.code, SECRET))).result).toBe("ACCEPTED");
  });
});

describe("respaldo escrito: código + OTP", () => {
  it("con el OTP vigente entra; con uno equivocado o vencido no", async () => {
    const { sessionId, ticket, key } = await setup();
    const now = Date.now();
    const code = `${ticket.code.slice(0, 5)}-${ticket.code.slice(5)}`;
    expect((await scan(sessionId, `${code} 000000`, { method: "MANUAL" })).result).toBe("INVALID");
    const stale = await dynamicOtp(key, ticket.code, stepAt(now) - 10);
    expect((await scan(sessionId, `${code} ${stale}`, { method: "MANUAL" })).result).toBe("INVALID");
    const otp = await dynamicOtp(key, ticket.code, stepAt(now));
    expect((await scan(sessionId, `${code} ${otp}`, { method: "MANUAL" })).result).toBe("ACCEPTED");
  });
});

describe("lecturas hechas sin conexión (se verifican al sincronizar)", () => {
  it("una lectura auténtica de hace un rato entra sin alertas", async () => {
    const { sessionId, ticket, key } = await setup();
    const at = new Date(Date.now() - 20 * 60_000); // la puerta estuvo sin señal
    const qr = await signDynamicPayload(key, ticket.code, at.getTime());
    const out = await scan(sessionId, qr, { offline: true, scannedAt: at });
    expect(out.result).toBe("ACCEPTED");
    expect(out.proofNote).toBeUndefined();
  });

  it("si la hora de la lectura no cuadra con la prueba, entra pero queda anotado", async () => {
    const { sessionId, ticket, key } = await setup();
    const at = new Date(Date.now() - 20 * 60_000);
    const qr = await signDynamicPayload(key, ticket.code, at.getTime() - 30 * 60_000); // 30 min antes de lo que dice el teléfono
    const out = await scan(sessionId, qr, { offline: true, scannedAt: at });
    expect(out.result).toBe("ACCEPTED");
    expect(out.proofNote).toBe("STALE_OFFLINE");
  });

  it("una prueba falsificada que el teléfono dio por buena se rechaza y se marca", async () => {
    const { sessionId, ticket } = await setup();
    const at = new Date(Date.now() - 60_000);
    const forged = `TK2.${ticket.code}.${stepAt(at.getTime()).toString(36)}.AAAAAAAAAAA`;
    const out = await scan(sessionId, forged, { offline: true, scannedAt: at });
    expect(out.result).toBe("INVALID");
    expect(out.proofNote).toBe("BAD_PROOF");
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("VALID");
  });

  it("un rechazo decidido por el teléfono (QR vencido) solo se registra", async () => {
    const { sessionId, ticket, key } = await setup();
    const qr = await signDynamicPayload(key, ticket.code, Date.now() - 10 * 60_000);
    const out = await scan(sessionId, qr, { offline: true, offlineResult: "QR_EXPIRED" });
    expect(out.result).toBe("QR_EXPIRED");
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("VALID");
  });
});

describe("descarga para la puerta", () => {
  it("las entradas dinámicas llevan su llave y las estáticas no", async () => {
    const dyn = await setup("DYNAMIC");
    const st = await setup("STATIC");
    const d = await getDoorDownload({ sessionId: dyn.sessionId });
    const s = await getDoorDownload({ sessionId: st.sessionId });
    const dRow = d!.tickets.find((t) => t.code === dyn.ticket.code) as { dynamic: boolean; key: string };
    const sRow = s!.tickets.find((t) => t.code === st.ticket.code) as { dynamic: boolean; key?: string };
    expect(dRow.dynamic).toBe(true);
    expect(sRow.dynamic).toBe(false);
    expect(sRow.key).toBeUndefined();

    // La llave descargada sirve para verificar pruebas igual que la del servidor.
    const phoneKey = fromBase64Url(dRow.key);
    const payload = parseDynamicPayload(await signDynamicPayload(dyn.key, dyn.ticket.code, Date.now()))!;
    expect(await verifyDynamicPayload(phoneKey, payload, Date.now())).toBe("OK");
    // Y la hora del servidor para calibrar el reloj.
    expect(Math.abs(new Date(d!.syncedAt).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("una puerta restringida a otra sección no recibe llaves de entradas ajenas", async () => {
    const { session, ticket } = await setup("DYNAMIC");
    const venue = await prisma.venue.findFirstOrThrow({ where: { sessions: { some: { id: session.id } } }, include: { accessPoints: true } });
    const otherSection = await prisma.section.create({ data: { venueId: venue.id, name: "Otra", seatingMode: "GENERAL_ADMISSION", capacity: 5 } });
    await prisma.accessPoint.update({ where: { id: venue.accessPoints[0]!.id }, data: { sections: { set: [{ id: otherSection.id }] } } });
    const download = await getDoorDownload({ sessionId: session.id, accessPointId: venue.accessPoints[0]!.id });
    const row = download!.tickets.find((t) => t.code === ticket.code) as { mine: boolean; key?: string };
    expect(row.mine).toBe(false);
    expect(row.key).toBeUndefined();
  });
});
