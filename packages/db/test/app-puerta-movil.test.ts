/**
 * App móvil de puerta: login con token por teléfono, funciones asignadas al portero,
 * métodos de lectura por tipo de entrada y descarga para validar sin internet.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { createStaffUser } from "../src/operations/accounts";
import {
  authenticateDevice,
  canControlSession,
  getDoorAssignments,
  getDoorDownload,
  revokeDevice,
  startDeviceSession,
} from "../src/operations/mobile";
import { getLiveAccess } from "../src/operations/live";
import { changeStaffPassword } from "../src/operations/accounts";
import { sellAtBoxOffice } from "../src/operations/sales";
import { createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

const PASSWORD = "Prueba2026!";

async function setup(methods: ("QR" | "BARCODE" | "NFC")[] = ["QR"]) {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 20, types: [{ name: "General", capacity: 20 }] });
  await prisma.ticketType.update({ where: { id: types[0]!.id }, data: { accessMethods: methods } });
  const full = await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id }, include: { event: true } });
  const orgId = full.event.organizationId;
  const email = () => `p-${randomCode(6).toLowerCase()}@prueba.test`;
  const operator = (await createStaffUser({ organizationId: orgId, name: "Portero", email: email(), password: PASSWORD, role: "OPERATOR" }))!;
  const cashier = (await createStaffUser({ organizationId: orgId, name: "Cajero", email: email(), password: PASSWORD, role: "CASHIER" }))!;
  return { session, type: types[0]!, orgId, operator, cashier };
}

async function login(email: string) {
  const result = await startDeviceSession({ email, password: PASSWORD, deviceId: `dev-${randomCode(6)}`, deviceName: "Moto G" });
  if ("error" in result) throw new Error(result.error);
  return result;
}

async function sell(sessionId: string, ticketTypeId: string, staffId: string, quantity = 1) {
  const order = await sellAtBoxOffice(
    { sessionId, items: [{ ticketTypeId, quantity }], buyer: { name: "Venta en caja", email: "caja@prueba.test", document: "7654321" } },
    { staffId, method: "EFECTIVO" },
  );
  return prisma.ticket.findMany({ where: { orderId: order.id } });
}

describe("sesión del teléfono", () => {
  it("el portero inicia sesión y el token se puede verificar y revocar", async () => {
    const { operator, orgId } = await setup();
    const { token } = await login(operator.email);
    expect(await authenticateDevice(token)).toMatchObject({ id: operator.id, role: "OPERATOR" });

    const row = await prisma.deviceToken.findFirstOrThrow({ where: { userId: operator.id } });
    expect(row.tokenHash).not.toBe(token); // solo se guarda el hash
    await revokeDevice(row.id, orgId);
    expect(await authenticateDevice(token)).toBeNull();
  });

  it("rechaza contraseña incorrecta y roles que no usan la app", async () => {
    const { operator, cashier } = await setup();
    expect(await startDeviceSession({ email: operator.email, password: "mala", deviceId: "dev-1234", deviceName: "x" })).toEqual({ error: "CREDENTIALS" });
    expect(await startDeviceSession({ email: cashier.email, password: PASSWORD, deviceId: "dev-1234", deviceName: "x" })).toMatchObject({ error: "ROLE" });
  });

  it("una cuenta desactivada pierde el acceso aunque tenga token", async () => {
    const { operator } = await setup();
    const { token } = await login(operator.email);
    await prisma.staffUser.update({ where: { id: operator.id }, data: { active: false } });
    expect(await authenticateDevice(token)).toBeNull();
  });
});

describe("funciones asignadas", () => {
  it("el portero solo ve las funciones que le asignaron, con los métodos de lectura de sus entradas", async () => {
    const { session, operator, orgId } = await setup(["BARCODE", "NFC"]);
    const staff = { id: operator.id, name: "Portero", email: operator.email, role: "OPERATOR" as const, organizationId: orgId };

    expect(await getDoorAssignments(staff)).toHaveLength(0);
    expect(await canControlSession(staff, session.id)).toBeNull();

    await prisma.doorAssignment.create({ data: { userId: operator.id, sessionId: session.id } });
    const [assigned] = await getDoorAssignments(staff);
    expect(assigned).toMatchObject({ sessionId: session.id, methods: ["BARCODE", "NFC"] });
    expect(await canControlSession(staff, session.id)).not.toBeNull();
  });
});

describe("métodos de lectura", () => {
  it("una entrada solo-código-de-barras no se acepta por QR ni NFC, y sigue válida", async () => {
    const { session, type, cashier } = await setup(["BARCODE"]);
    const [ticket] = await sell(session.id, type.id, cashier.id);

    const byQr = await scanTicket({ sessionId: session.id, raw: ticket!.code, method: "QR" });
    expect(byQr.result).toBe("METHOD_NOT_ALLOWED");
    const byNfc = await scanTicket({ sessionId: session.id, raw: ticket!.code, method: "NFC" });
    expect(byNfc.result).toBe("METHOD_NOT_ALLOWED");
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket!.id } })).status).toBe("VALID");

    expect((await scanTicket({ sessionId: session.id, raw: ticket!.code, method: "BARCODE" })).result).toBe("ACCEPTED");
    expect((await scanTicket({ sessionId: session.id, raw: ticket!.code, method: "BARCODE" })).result).toBe("ALREADY_USED");
  });

  it("el código escrito a mano siempre se admite (respaldo si el lector falla)", async () => {
    const { session, type, cashier } = await setup(["NFC"]);
    const [ticket] = await sell(session.id, type.id, cashier.id);
    expect((await scanTicket({ sessionId: session.id, raw: ticket!.code, method: "MANUAL" })).result).toBe("ACCEPTED");
  });

  it("guarda con qué método se leyó cada entrada", async () => {
    const { session, type, cashier } = await setup(["QR", "NFC"]);
    const [ticket] = await sell(session.id, type.id, cashier.id);
    await scanTicket({ sessionId: session.id, raw: ticket!.code, method: "NFC" });
    const scan = await prisma.accessScan.findFirstOrThrow({ where: { ticketId: ticket!.id } });
    expect(scan.method).toBe("NFC");
  });
});

describe("descarga para validar sin internet", () => {
  it("las entradas de otras puertas van compactas y solo se envían los cambios con `since`", async () => {
    const { session, type, cashier } = await setup(["QR", "BARCODE"]);
    const [first] = await sell(session.id, type.id, cashier.id);
    const venueId = session.venueId;
    const gates = await prisma.accessPoint.findMany({ where: { venueId }, orderBy: { name: "asc" } });
    const section = await prisma.section.findFirstOrThrow({ where: { venueId } });
    // La Puerta 1 recibe la sección de la entrada; la Puerta 2, otra sección.
    await prisma.accessPoint.update({ where: { id: gates[0]!.id }, data: { sections: { connect: { id: section.id } } } });
    const other = await prisma.section.create({ data: { venueId, name: "Palco", seatingMode: "GENERAL_ADMISSION", capacity: 5 } });
    await prisma.accessPoint.update({ where: { id: gates[1]!.id }, data: { sections: { connect: { id: other.id } } } });

    const mine = await getDoorDownload({ sessionId: session.id, accessPointId: gates[0]!.id });
    expect(mine!.full).toBe(true);
    expect(mine!.tickets[0]).toMatchObject({ code: first!.code, mine: true, methods: ["QR", "BARCODE"] });

    const elsewhere = await getDoorDownload({ sessionId: session.id, accessPointId: gates[1]!.id });
    expect(elsewhere!.tickets[0]).toEqual({ code: first!.code, status: "V", sectionId: section.id, mine: false });

    const since = new Date();
    const delta = await getDoorDownload({ sessionId: session.id, accessPointId: gates[0]!.id, since });
    expect(delta!.full).toBe(false);
    expect(delta!.tickets).toHaveLength(0);

    await scanTicket({ sessionId: session.id, raw: first!.code, method: "QR", accessPointId: gates[0]!.id });
    const afterScan = await getDoorDownload({ sessionId: session.id, accessPointId: gates[0]!.id, since });
    expect(afterScan!.tickets).toMatchObject([{ code: first!.code, status: "U" }]);
  });
});

describe("ingreso en vivo", () => {
  it("muestra quién entró, por qué puerta y a qué hora, y cada intento rechazado", async () => {
    const { session, type, cashier, operator } = await setup(["QR", "BARCODE"]);
    const [first, second] = await sell(session.id, type.id, cashier.id, 2);
    const gate = await prisma.accessPoint.findFirstOrThrow({ where: { venueId: session.venueId }, orderBy: { name: "asc" } });
    const at = new Date(Date.now() - 60_000);

    await scanTicket({ sessionId: session.id, raw: first!.code, method: "QR", accessPointId: gate.id, operatorId: operator.id, scannedAt: at, offline: true });
    // Reingreso por otra puerta, decidido por el teléfono sin conexión.
    await scanTicket({
      sessionId: session.id,
      raw: first!.code,
      method: "QR",
      accessPointId: gate.id,
      operatorId: operator.id,
      offline: true,
      offlineResult: "ALREADY_USED",
    });

    const live = (await getLiveAccess(session.id))!;
    expect(live.totals).toMatchObject({ issued: 2, entered: 1, rejected: 1 });
    const entered = live.tickets.find((t) => t.id === first!.id)!;
    expect(entered.status).toBe("USED");
    expect(entered.entry).toMatchObject({ gate: gate.name, operator: "Portero", method: "QR" });
    expect(entered.entry!.at).toBe(at.toISOString());
    expect(entered.attempts).toHaveLength(1);
    expect(entered.attempts[0]).toMatchObject({ result: "ALREADY_USED", gate: gate.name });
    expect(live.tickets.find((t) => t.id === second!.id)!.entry).toBeNull();
    expect(live.rejected[0]).toMatchObject({ result: "ALREADY_USED", code: first!.code });
    expect(live.sections[0]).toMatchObject({ issued: 2, entered: 1 });
  });
});

describe("organizadores y la app móvil", () => {
  it("un portero de un organizador no puede controlar funciones de otro", async () => {
    const a = await setup();
    const b = await setup();
    const staffA = { id: a.operator.id, name: "A", email: a.operator.email, role: "OPERATOR" as const, organizationId: a.orgId };
    await prisma.doorAssignment.create({ data: { userId: a.operator.id, sessionId: a.session.id } });
    // Aunque tenga una asignación forzada a la función ajena, la organización no coincide.
    await prisma.doorAssignment.create({ data: { userId: a.operator.id, sessionId: b.session.id } });
    expect(await canControlSession(staffA, a.session.id)).not.toBeNull();
    expect(await canControlSession(staffA, b.session.id)).toBeNull();
    expect((await getDoorAssignments(staffA)).map((x) => x.sessionId)).toEqual([a.session.id]);
  });

  it("suspender al organizador corta los teléfonos al instante", async () => {
    const { operator, orgId } = await setup();
    const { token } = await login(operator.email);
    expect(await authenticateDevice(token)).not.toBeNull();
    await prisma.organization.update({ where: { id: orgId }, data: { status: "SUSPENDED" } });
    expect(await authenticateDevice(token)).toBeNull();
    expect(await startDeviceSession({ email: operator.email, password: PASSWORD, deviceId: "dev-9999", deviceName: "x" })).toEqual({ error: "CREDENTIALS" });
  });

  it("una cuenta con contraseña temporal lo indica hasta que la cambia", async () => {
    const { operator } = await setup();
    await prisma.staffUser.update({ where: { id: operator.id }, data: { mustChangePassword: true } });
    const first = await login(operator.email);
    expect(first.staff.mustChangePassword).toBe(true);
    expect((await authenticateDevice(first.token))?.mustChangePassword).toBe(true);

    expect(await changeStaffPassword(operator.id, "otra-mala", "NuevaClave2026!")).toBe(false);
    // La app cambia la contraseña desde su propia sesión: esa sesión se conserva.
    expect(await changeStaffPassword(operator.id, PASSWORD, "NuevaClave2026!", { keepDeviceTokenId: first.deviceTokenId })).toBe(true);
    expect((await authenticateDevice(first.token))?.mustChangePassword).toBe(false);
  });
});
