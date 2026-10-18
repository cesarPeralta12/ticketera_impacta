/**
 * Importar entradas desde Excel: vista previa con errores por fila (sin tocar el cupo), confirmación todo o nada con
 * canal IMPORT, butacas y mesas validadas contra el mapa, y deshacer el lote (las usadas quedan).
 */
import { afterAll, describe, expect, it } from "vitest";
import { parseImportTable, randomCode, type ImportRow } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { confirmImport, createImportDraft, getImportSummary, undoImport } from "../src/operations/imports";
import { getSessionAvailability } from "../src/operations/orders";
import { getEventReport } from "../src/operations/report";
import { createGeneralAdmissionEvent, createPendingOrder, createSeatedEvent, buyer } from "./fixtures";

afterAll(() => prisma.$disconnect());

async function staff() {
  return prisma.staffUser.create({ data: { email: `importa-${randomCode(6).toLowerCase()}@prueba.test`, name: "Importa", passwordHash: "!" } });
}

const HEADER = ["Función", "Tipo de entrada", "Nombre", "Carnet", "Correo", "Butaca o mesa", "Monto cobrado (Bs)"];
const parse = (rows: string[][]) => parseImportTable([HEADER, ...rows]);

async function draft(eventId: string, staffId: string, rows: string[][]) {
  return createImportDraft({ eventId, staffId, fileName: "prueba.xlsx", parsed: parse(rows) });
}

describe("importar entradas desde Excel", () => {
  it("la vista previa marca errores por fila y no ocupa cupo", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 3, types: [{ name: "General", capacity: 3 }] });
    const s = await staff();
    const batch = await draft(session.eventId, s.id, [
      ["", "General", "Ana Pérez", "111", "ana@prueba.test", "", "150"],
      ["", "Platea", "Luis Rojas", "", "", "", ""],
      ["", "general", "Eva Díaz", "111", "", "", ""],
      ["", "General", "Juan Soto", "", "", "B-4", ""],
      ["", "General", "Rosa Vera", "", "", "", ""],
      ["", "General", "Mario Paz", "", "", "", ""],
    ]);
    expect(batch.status).toBe("DRAFT");
    const errors = batch.errors as { line: number; message: string }[];
    expect(errors.map((e) => e.line)).toEqual([3, 4, 7]);
    expect(errors[0]!.message).toContain('"Platea" no existe');
    expect(errors[1]!.message).toContain("repetido (fila 2)");
    expect(errors[2]!.message).toContain("Sin cupo");
    expect((batch.warnings as { line: number }[]).map((w) => w.line)).toEqual([5]);
    expect(batch.validRows).toBe(3);
    expect((await getSessionAvailability(session.id)).get(types[0]!.id)).toBe(3);

    // Con errores no se confirma, salvo dejándolos fuera.
    await expect(confirmImport({ batchId: batch.id, staffId: s.id })).rejects.toMatchObject({ code: "INVALID_ITEMS" });
    await confirmImport({ batchId: batch.id, staffId: s.id, skipErrors: true });
    expect((await getSessionAvailability(session.id)).get(types[0]!.id)).toBe(0);
    await expect(confirmImport({ batchId: batch.id, staffId: s.id, skipErrors: true })).rejects.toMatchObject({ code: "INVALID_STATE" });

    const orders = await prisma.order.findMany({ where: { importBatchId: batch.id }, include: { tickets: true }, orderBy: { buyerName: "asc" } });
    expect(orders.map((o) => [o.buyerName, o.channel, o.status, o.totalAmount, o.tickets.length])).toEqual([
      ["Ana Pérez", "IMPORT", "PAID", 15_000, 1],
      ["Juan Soto", "IMPORT", "PAID", 0, 1],
      ["Rosa Vera", "IMPORT", "PAID", 0, 1],
    ]);
    expect((await scanTicket({ sessionId: session.id, raw: orders[0]!.tickets[0]!.code })).result).toBe("ACCEPTED");

    const report = await getEventReport(session.eventId);
    expect(report!.byChannel.find((c) => c.channel === "IMPORT")).toMatchObject({ tickets: 3, revenue: 15_000 });
  });

  it("si se vendió algo desde la vista previa, no importa nada", async () => {
    const { session } = await createGeneralAdmissionEvent({ sectionCapacity: 2, types: [{ name: "General", capacity: 2 }] });
    const s = await staff();
    const batch = await draft(session.eventId, s.id, [
      ["", "General", "Ana Pérez", "", "", "", ""],
      ["", "General", "Luis Rojas", "", "", "", ""],
    ]);
    expect(batch.errors).toEqual([]);
    const type = await prisma.ticketType.findFirstOrThrow({ where: { sessionId: session.id } });
    await createPendingOrder({ sessionId: session.id, buyer: buyer(1), items: [{ ticketTypeId: type.id, quantity: 1 }] });
    await expect(confirmImport({ batchId: batch.id, staffId: s.id })).rejects.toMatchObject({ code: "SOLD_OUT" });
    expect(await prisma.order.count({ where: { importBatchId: batch.id } })).toBe(0);
  });

  it("butacas validadas contra el mapa", async () => {
    const { session, sections } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 5 }] });
    const s = await staff();
    const seat = sections[0]!.seats[1]!; // A-2
    await createPendingOrder({ sessionId: session.id, buyer: buyer(2), items: [{ ticketTypeId: sections[0]!.ticketType.id, quantity: 1, seatIds: [seat.id] }] });
    const batch = await draft(session.eventId, s.id, [
      ["1", "Platea", "Ana Pérez", "", "", "A 1", ""],
      ["1", "Platea", "Luis Rojas", "", "", "", ""],
      ["1", "Platea", "Eva Díaz", "", "", "A-9", ""],
      ["1", "Platea", "Juan Soto", "", "", "a1", ""],
      ["1", "Platea", "Rosa Vera", "", "", "A-2", ""],
      ["1", "Platea", "Mario Paz", "", "", "A3", ""],
    ]);
    const errors = batch.errors as { line: number; message: string }[];
    expect(errors.map((e) => [e.line, e.message])).toEqual([
      [3, '"Platea" es numerada: falta la butaca.'],
      [4, 'La butaca "A-9" no existe en Platea.'],
      [5, "A-1 está repetida (fila 2)."],
      [6, "A-2 ya está vendida o reservada."],
    ]);
    await confirmImport({ batchId: batch.id, staffId: s.id, skipErrors: true });
    const tickets = await prisma.ticket.findMany({ where: { order: { importBatchId: batch.id } }, include: { seat: true } });
    expect(tickets.map((t) => t.seat?.label).sort()).toEqual(["A-1", "A-3"]);
  });

  it("mesas: una fila emite una entrada por persona, con su número", async () => {
    const { session } = await createGeneralAdmissionEvent({ sectionCapacity: 100, types: [{ name: "Mesa VIP", capacity: 5 }] });
    await prisma.ticketType.updateMany({ where: { sessionId: session.id }, data: { kind: "TABLE", peoplePerUnit: 4, consumptionAmount: 50_000 } });
    const s = await staff();
    const batch = await draft(session.eventId, s.id, [
      ["", "Mesa VIP", "Ana Pérez", "", "", "Mesa 3", "1200"],
      ["", "Mesa VIP", "Luis Rojas", "", "", "", ""],
      ["", "Mesa VIP", "Eva Díaz", "", "", "3", ""],
    ]);
    expect((batch.errors as { message: string }[])[0]!.message).toContain("mesa 3");
    expect(batch.ticketCount).toBe(8);
    await confirmImport({ batchId: batch.id, staffId: s.id, skipErrors: true });
    const credits = await prisma.consumptionCredit.findMany({ where: { order: { importBatchId: batch.id } }, include: { tickets: true }, orderBy: { tableNumber: "asc" } });
    expect(credits.map((c) => [c.tableNumber, c.tickets.length, c.amount])).toEqual([
      [3, 4, 50_000],
      [4, 4, 50_000],
    ]);
  });

  it("deshacer anula las no usadas y libera el cupo; las usadas quedan", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    const s = await staff();
    const rows: ImportRow[] = Array.from({ length: 4 }, (_, i) => ({ line: i + 2, session: "", type: "General", name: `Persona ${i}`, document: null, email: `p${i}@prueba.test`, place: null, amount: 0 }));
    const batch = await createImportDraft({ eventId: session.eventId, staffId: s.id, fileName: "x.csv", parsed: { rows, errors: [], total: 4 } });
    await confirmImport({ batchId: batch.id, staffId: s.id });
    const first = await prisma.ticket.findFirstOrThrow({ where: { order: { importBatchId: batch.id } } });
    await scanTicket({ sessionId: session.id, raw: first.code });

    expect(await undoImport({ batchId: batch.id, staffId: s.id })).toEqual({ cancelled: 3, used: 1 });
    expect((await getSessionAvailability(session.id)).get(types[0]!.id)).toBe(9);
    const summary = await getImportSummary(batch.id);
    expect(summary!.batch.status).toBe("UNDONE");
    expect(summary!.tickets).toEqual({ valid: 0, used: 1, cancelled: 3 });
    expect(summary!.email.pending).toBe(1);
    await expect(undoImport({ batchId: batch.id, staffId: s.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("no importa entradas de QR dinámico y pide la función si hay varias", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "App", capacity: 10 }] });
    await prisma.ticketType.update({ where: { id: types[0]!.id }, data: { qrMode: "DYNAMIC" } });
    await prisma.eventSession.create({ data: { eventId: session.eventId, venueId: session.venueId, startsAt: new Date(Date.now() + 40 * 86_400_000) } });
    const s = await staff();
    const batch = await draft(session.eventId, s.id, [
      ["1", "App", "Ana Pérez", "", "", "", ""],
      ["", "App", "Luis Rojas", "", "", "", ""],
    ]);
    expect((batch.errors as { message: string }[]).map((e) => e.message)).toEqual([
      expect.stringContaining("QR dinámico"),
      "Falta la función (el evento tiene varias).",
    ]);
  });
});
