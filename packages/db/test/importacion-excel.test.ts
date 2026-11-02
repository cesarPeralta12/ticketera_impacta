/**
 * Importar entradas desde Excel: vista previa con errores por fila (sin tocar el cupo), confirmación todo o nada con
 * canal IMPORT, butacas y mesas validadas contra el mapa, y deshacer el lote (las usadas quedan).
 */
import { afterAll, describe, expect, it } from "vitest";
import { parseImportTable, randomCode, type ImportRow } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { assignImportSeats, confirmImport, createImportDraft, deleteImportFormat, getImportSummary, listImportFormats, listPendingSeatRows, saveImportFormat, undoImport } from "../src/operations/imports";
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

    // Con un error no se emite nada, ni las filas buenas: se corrige el archivo y se vuelve a subir.
    await expect(confirmImport({ batchId: batch.id, staffId: s.id })).rejects.toMatchObject({ code: "INVALID_ITEMS" });
    expect(await prisma.order.count({ where: { importBatchId: batch.id } })).toBe(0);
    expect((await getSessionAvailability(session.id)).get(types[0]!.id)).toBe(3);

    const fixed = await draft(session.eventId, s.id, [
      ["", "General", "Ana Pérez", "111", "ana@prueba.test", "", "150"],
      ["", "General", "Juan Soto", "", "", "B-4", ""],
      ["", "General", "Rosa Vera", "", "", "", ""],
    ]);
    await confirmImport({ batchId: fixed.id, staffId: s.id });
    expect((await getSessionAvailability(session.id)).get(types[0]!.id)).toBe(0);
    await expect(confirmImport({ batchId: fixed.id, staffId: s.id })).rejects.toMatchObject({ code: "INVALID_STATE" });

    const orders = await prisma.order.findMany({ where: { importBatchId: fixed.id }, include: { tickets: true }, orderBy: { buyerName: "asc" } });
    expect(orders.map((o) => [o.buyerName, o.channel, o.status, o.totalAmount, o.tickets.length])).toEqual([
      ["Ana Pérez", "IMPORT", "PAID", 15_000, 1],
      ["Juan Soto", "IMPORT", "PAID", 0, 1],
      ["Rosa Vera", "IMPORT", "PAID", 0, 1],
    ]);
    expect((await scanTicket({ sessionId: session.id, raw: orders[0]!.tickets[0]!.code })).result).toBe("ACCEPTED");

    const report = await getEventReport(session.eventId);
    expect(report!.byChannel.find((c) => c.channel === "IMPORT")).toMatchObject({ tickets: 3, revenue: 15_000 });
    expect(report!.importSources).toEqual([{ source: null, tickets: 3, used: 1, revenue: 15_000 }]);
  });

  it("pasando el cupo: sin la confirmación expresa no entra nada; con ella se emiten todas", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 2, types: [{ name: "General", capacity: 2 }] });
    const s = await staff();
    const batch = await draft(session.eventId, s.id, [
      ["", "General", "Ana Pérez", "", "", "", ""],
      ["", "General", "Luis Rojas", "", "", "", ""],
      ["", "General", "Eva Díaz", "", "", "", ""],
      ["", "General", "Juan Soto", "", "", "", ""],
    ]);
    const errors = batch.errors as { line: number; kind?: string }[];
    expect(errors.map((e) => [e.line, e.kind])).toEqual([[4, "capacity"], [5, "capacity"]]);
    await expect(confirmImport({ batchId: batch.id, staffId: s.id })).rejects.toMatchObject({ code: "INVALID_ITEMS" });
    expect(await prisma.order.count({ where: { importBatchId: batch.id } })).toBe(0);

    await confirmImport({ batchId: batch.id, staffId: s.id, overCapacity: true });
    expect(await prisma.ticket.count({ where: { order: { importBatchId: batch.id } } })).toBe(4);
    const done = await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect([done.status, done.validRows, done.ticketCount, (done.errors as unknown[]).length]).toEqual(["CONFIRMED", 4, 4, 0]);
    expect((await getSessionAvailability(session.id)).get(types[0]!.id)).toBeLessThanOrEqual(0);
  });

  it("los formatos guardados se repiten por organización: guardar con el mismo nombre reemplaza y borrar quita", async () => {
    const org = await prisma.organization.create({ data: { name: "Formatos", slug: `formatos-${randomCode(6).toLowerCase()}`, currency: "BOB" } });
    const base = { organizationId: org.id, name: "TuBoleto", sourceName: "TuBoleto", readMethod: "QR" as const, mapping: { headerRow: 0, columns: { code: 2 } }, titles: { code: "N° de ticket" } };
    await saveImportFormat(base);
    await saveImportFormat({ ...base, readMethod: "BARCODE", titles: { code: "Código" } });
    const [saved, ...rest] = await listImportFormats(org.id);
    expect(rest).toEqual([]);
    expect([saved!.readMethod, saved!.titles]).toEqual(["BARCODE", { code: "Código" }]);
    await deleteImportFormat("otra-organizacion", saved!.id);
    expect(await listImportFormats(org.id)).toHaveLength(1);
    await deleteImportFormat(org.id, saved!.id);
    expect(await listImportFormats(org.id)).toHaveLength(0);
  });

  it("las filas de un tipo numerado sin butaca se asignan en el mapa antes de confirmar", async () => {
    const { session, sections } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 5 }] });
    const s = await staff();
    const [a1, a2, a3, a4] = sections[0]!.seats;
    const batch = await draft(session.eventId, s.id, [
      ["1", "Platea", "Ana Pérez", "", "", "", ""],
      ["1", "Platea", "Luis Rojas", "", "", "", ""],
      ["1", "Platea", "Eva Díaz", "", "", "A 1", ""],
    ]);
    expect((batch.errors as { line: number; kind?: string }[]).map((e) => [e.line, e.kind])).toEqual([[2, "seat"], [3, "seat"]]);
    expect((await listPendingSeatRows(batch.id)).map((r) => r.name)).toEqual(["Ana Pérez", "Luis Rojas"]);
    await expect(confirmImport({ batchId: batch.id, staffId: s.id })).rejects.toMatchObject({ code: "INVALID_ITEMS" });

    // Una butaca de otra sección, o ya usada por otra fila, se rechaza; una sección distinta no existe aquí, así que se prueba la repetida.
    await expect(assignImportSeats({ batchId: batch.id, staffId: s.id, assignments: [{ line: 2, seatId: a1!.id }] })).rejects.toMatchObject({ code: "INVALID_ITEMS" });
    await expect(assignImportSeats({ batchId: batch.id, staffId: s.id, assignments: [{ line: 2, seatId: a2!.id }, { line: 3, seatId: a2!.id }] })).rejects.toMatchObject({ code: "INVALID_ITEMS" });

    // Una butaca vendida desde la vista previa vuelve a quedar como error de su fila.
    await createPendingOrder({ sessionId: session.id, buyer: buyer(7), items: [{ ticketTypeId: sections[0]!.ticketType.id, quantity: 1, seatIds: [a4!.id] }] });
    const partial = await assignImportSeats({ batchId: batch.id, staffId: s.id, assignments: [{ line: 2, seatId: a2!.id }, { line: 3, seatId: a4!.id }] });
    expect(partial).toEqual({ assigned: 2, errors: 1 });
    const left = await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect((left.errors as { line: number; message: string }[]).map((e) => [e.line, e.message])).toEqual([[3, "A-4 ya está vendida o reservada."]]);

    await assignImportSeats({ batchId: batch.id, staffId: s.id, assignments: [{ line: 3, seatId: a3!.id }] });
    await confirmImport({ batchId: batch.id, staffId: s.id });
    const tickets = await prisma.ticket.findMany({ where: { order: { importBatchId: batch.id } }, include: { seat: true }, orderBy: { holderName: "asc" } });
    expect(tickets.map((t) => [t.holderName, t.seat?.label])).toEqual([["Ana Pérez", "A-2"], ["Eva Díaz", "A-1"], ["Luis Rojas", "A-3"]]);
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
      [3, '"Platea" es numerada: falta la butaca. Asígnala en el mapa.'],
      [4, 'La butaca "A-9" no existe en Platea.'],
      [5, "A-1 está repetida (fila 2)."],
      [6, "A-2 ya está vendida o reservada."],
    ]);
    const fixed = await draft(session.eventId, s.id, [
      ["1", "Platea", "Ana Pérez", "", "", "A 1", ""],
      ["1", "Platea", "Mario Paz", "", "", "A3", ""],
    ]);
    await confirmImport({ batchId: fixed.id, staffId: s.id });
    const tickets = await prisma.ticket.findMany({ where: { order: { importBatchId: fixed.id } }, include: { seat: true } });
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
    const fixed = await draft(session.eventId, s.id, [
      ["", "Mesa VIP", "Ana Pérez", "", "", "Mesa 3", "1200"],
      ["", "Mesa VIP", "Luis Rojas", "", "", "", ""],
    ]);
    await confirmImport({ batchId: fixed.id, staffId: s.id });
    const credits = await prisma.consumptionCredit.findMany({ where: { order: { importBatchId: fixed.id } }, include: { tickets: true }, orderBy: { tableNumber: "asc" } });
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

  it("un archivo grande se emite por bloques: cada fila con su orden, su línea y su entrada", async () => {
    const total = 1_200; // más de dos bloques
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: total, types: [{ name: "General", capacity: total }] });
    const s = await staff();
    const batch = await draft(
      session.eventId,
      s.id,
      Array.from({ length: total }, (_, i) => ["", "General", `Persona ${i + 1}`, String(5_000_000 + i), "", "", i % 2 ? "80" : ""]),
    );
    await confirmImport({ batchId: batch.id, staffId: s.id });

    const orders = await prisma.order.findMany({ where: { importBatchId: batch.id }, include: { items: true, tickets: true } });
    expect(orders).toHaveLength(total);
    expect(orders.every((o) => o.items.length === 1 && o.tickets.length === 1 && o.tickets[0]!.orderItemId === o.items[0]!.id)).toBe(true);
    expect(orders.every((o) => o.tickets[0]!.holderName === o.buyerName && o.channel === "IMPORT" && o.status === "PAID")).toBe(true);
    expect(orders.reduce((sum, o) => sum + o.totalAmount, 0)).toBe((total / 2) * 8_000);
    expect((await getSessionAvailability(session.id)).get(types[0]!.id)).toBe(0);
  });
});
