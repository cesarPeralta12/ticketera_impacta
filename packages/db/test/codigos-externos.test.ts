/**
 * Cargar entradas que ya existen fuera de iPass (vendidas por un tercero) con su propio código, y que la puerta las
 * reconozca: el código se guarda limpio (clave), se rechazan repetidos y choques con códigos de iPass, y se lee escrito
 * de distintas formas. Lo de iPass sigue igual.
 */
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_CODE_RULE, parseMappedTable, randomCode, valueKey, type ImportMapping } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { confirmImport, createImportDraft, getImportSummary, undoImport, type ExternalReadMethod } from "../src/operations/imports";
import { getDoorDownload } from "../src/operations/mobile";
import { createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

async function staff() {
  return prisma.staffUser.create({ data: { email: `externo-${randomCode(6).toLowerCase()}@prueba.test`, name: "Importa", passwordHash: "!" } });
}

/** Un evento con dos funciones (la segunda, para "función equivocada") y un tipo General en cada una. */
async function twoNights() {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 50, types: [{ name: "General", capacity: 50 }] });
  const other = await prisma.eventSession.create({
    data: {
      eventId: session.eventId,
      venueId: session.venueId,
      startsAt: new Date(session.startsAt.getTime() + 86_400_000),
      ticketTypes: { create: { name: "General", sectionId: types[0]!.sectionId, unitAmount: 10_000, currency: "CLP", capacity: 50 } },
    },
  });
  return { session, other, type: types[0]! };
}

/** El archivo de otro proveedor: Nombre, Código y Correo; el tipo es el mismo para todas («todas son General»). */
async function importFile(eventId: string, staffId: string, rows: string[][], opts: { session?: string; readMethod?: ExternalReadMethod; type?: string } = {}) {
  const table = [["Nombre", "Código", "Correo"], ...rows];
  const mapping: ImportMapping = {
    headerRow: 0,
    columns: { name: 0, code: 1, email: 2 },
    fixed: { type: opts.type ?? "General", session: opts.session },
    values: {},
    codeRule: DEFAULT_CODE_RULE,
  };
  return createImportDraft({
    eventId,
    staffId,
    fileName: "tuboleto.xlsx",
    parsed: parseMappedTable(table, mapping),
    external: { sourceName: "TuBoleto", codeRule: DEFAULT_CODE_RULE, readMethod: opts.readMethod ?? "QR", mapping },
  });
}

const scan = (sessionId: string, raw: string, method: "QR" | "BARCODE" | "MANUAL" = "QR") => scanTicket({ sessionId, raw, method });

describe("entradas con el código de otro proveedor", () => {
  it("se cargan con su código (con ceros, con guiones o dentro de un enlace) y la puerta las lee escritas de otras formas", async () => {
    const { session, other } = await twoNights();
    const s = await staff();
    const label = "1.";
    const batch = await importFile(session.eventId, s.id, [
      ["Ana Pérez", "00123", ""],
      ["Luis Rojas", "VIP-2026-0456", ""],
      ["Marta Quispe", "https://proveedor.com/t/ABC9", ""],
      ["Sin código", "", ""],
    ], { session: label });
    expect(batch.errors).toEqual([]);
    expect(batch.sourceName).toBe("TuBoleto");
    await confirmImport({ batchId: batch.id, staffId: s.id });

    const tickets = await prisma.ticket.findMany({ where: { order: { importBatchId: batch.id } }, orderBy: { holderName: "asc" }, select: { holderName: true, externalCode: true, externalKey: true, code: true } });
    expect(tickets.map((t) => [t.holderName, t.externalCode, t.externalKey])).toEqual([
      ["Ana Pérez", "00123", "00123"],
      ["Luis Rojas", "VIP-2026-0456", "VIP20260456"],
      ["Marta Quispe", "https://proveedor.com/t/ABC9", "ABC9"],
      // Sin código en el archivo: recibe uno propio de iPass (como siempre).
      ["Sin código", null, null],
    ]);

    // El mismo código escrito distinto: en minúsculas, con espacios en vez de guiones.
    expect((await scan(session.id, "vip 2026 0456")).result).toBe("ACCEPTED");
    expect((await scan(session.id, "VIP-2026-0456")).result).toBe("ALREADY_USED");
    // Los ceros a la izquierda cuentan: 123 no es 00123.
    expect((await scan(session.id, "123", "MANUAL")).result).not.toBe("ACCEPTED");
    expect((await scan(session.id, "00123")).result).toBe("ACCEPTED");
    // El QR del tercero con el enlace completo.
    expect((await scan(session.id, "https://proveedor.com/t/ABC9")).result).toBe("ACCEPTED");
    // La entrada de iPass de la fila sin código sigue funcionando igual.
    expect((await scan(session.id, tickets[3]!.code, "MANUAL")).result).toBe("ACCEPTED");
    // En la otra función del evento: función equivocada (no "no existe").
    expect((await scan(other.id, "abc9")).result).toBe("WRONG_SESSION");
    // Un código que no existe no rompe nada.
    expect((await scan(session.id, "NO-EXISTE-999")).result).toBe("INVALID");
  });

  it("el tipo de entrada tiene que admitir cómo se lee (código de barras en un tipo solo QR)", async () => {
    const { session, type } = await twoNights();
    const s = await staff();
    const barcode = await importFile(session.eventId, s.id, [["Ana", "BAR-1", ""]], { session: "1.", readMethod: "BARCODE" });
    expect((barcode.errors as { message: string }[])[0]!.message).toMatch(/no se lee con código de barras/);

    await prisma.ticketType.update({ where: { id: type.id }, data: { accessMethods: ["QR", "BARCODE"] } });
    const ok = await importFile(session.eventId, s.id, [["Ana", "BAR-1", ""]], { session: "1.", readMethod: "BARCODE" });
    expect(ok.errors).toEqual([]);
    await confirmImport({ batchId: ok.id, staffId: s.id });
    expect((await scan(session.id, "bar1", "BARCODE")).result).toBe("ACCEPTED");
    // Leído por NFC no corresponde: el tipo solo admite QR y código de barras.
    await prisma.ticketType.update({ where: { id: type.id }, data: { accessMethods: ["QR"] } });
    expect((await scanTicket({ sessionId: session.id, raw: "BAR-1", method: "BARCODE" })).result).toBe("METHOD_NOT_ALLOWED");
  });

  it("no se repite un código en la función ni choca con uno de iPass; al deshacer el lote se puede volver a cargar", async () => {
    const { session } = await twoNights();
    const s = await staff();
    const first = await importFile(session.eventId, s.id, [["Ana", "X-1", ""], ["Sin código", "", ""]], { session: "1." });
    await confirmImport({ batchId: first.id, staffId: s.id });
    const own = await prisma.ticket.findFirstOrThrow({ where: { order: { importBatchId: first.id }, externalKey: null } });

    const second = await importFile(session.eventId, s.id, [["Luis", "x1", ""], ["Eva", own.code, ""]], { session: "1." });
    const errors = second.errors as { line: number; message: string }[];
    expect(errors.map((e) => e.line)).toEqual([2, 3]);
    expect(errors[0]!.message).toMatch(/ya está cargado en esta función/);
    expect(errors[1]!.message).toMatch(/igual al de una entrada de iPass/);

    // Al deshacer, la clave del código se libera y el archivo corregido entra.
    await undoImport({ batchId: first.id, staffId: s.id });
    const again = await importFile(session.eventId, s.id, [["Ana", "X-1", ""]], { session: "1." });
    expect(again.errors).toEqual([]);
    await confirmImport({ batchId: again.id, staffId: s.id });
    expect((await scan(session.id, "x1")).result).toBe("ACCEPTED");
  });

  it("una mesa de varias personas no se carga con un solo código", async () => {
    const { session, type } = await twoNights();
    const s = await staff();
    await prisma.ticketType.update({ where: { id: type.id }, data: { kind: "TABLE", peoplePerUnit: 4, capacity: 5 } });
    const batch = await importFile(session.eventId, s.id, [["Mesa de Ana", "M-1", ""]], { session: "1." });
    expect((batch.errors as { message: string }[])[0]!.message).toMatch(/mesa de 4 personas/);
  });

  it("el teléfono descarga la clave y las reglas; quien ya tiene su entrada no recibe otra por correo", async () => {
    const { session } = await twoNights();
    const s = await staff();
    const batch = await importFile(
      session.eventId,
      s.id,
      [
        ["Ana", "Q-77", "ana@prueba.test"],
        ["Luis", "", "luis@prueba.test"],
      ],
      { session: "1." },
    );
    await confirmImport({ batchId: batch.id, staffId: s.id });
    const download = await getDoorDownload({ sessionId: session.id });
    const imported = download!.tickets.filter((t) => "externalKey" in t);
    expect(imported.map((t) => (t as { externalKey: string }).externalKey)).toEqual(["Q77"]);
    expect(download!.session).toMatchObject({ requiresApp: "1.8.0", codeRules: [expect.objectContaining({ ignoreSeparators: true })] });
    // Solo Luis (entrada de iPass, sin código del tercero) está para enviar por correo.
    expect((await getImportSummary(batch.id))!.email.pending).toBe(1);
  });

  it("emparejar el tipo por valores del archivo, sin distinguir mayúsculas ni tildes", async () => {
    const { session } = await twoNights();
    const s = await staff();
    const table = [
      ["Nombre", "Código", "Sector"],
      ["Ana", "S-1", "GENERAL"],
      ["Luis", "S-2", "géneral "],
      ["Marta", "S-3", "Palco"],
    ];
    const mapping: ImportMapping = {
      headerRow: 0,
      columns: { name: 0, code: 1, type: 2 },
      fixed: { session: "1." },
      values: { type: { [valueKey("General")]: "General", [valueKey("géneral")]: "General" } },
      codeRule: DEFAULT_CODE_RULE,
    };
    const parsed = parseMappedTable(table, mapping);
    const batch = await createImportDraft({ eventId: session.eventId, staffId: s.id, fileName: "x.csv", parsed, external: { sourceName: null, codeRule: DEFAULT_CODE_RULE, readMethod: "QR", mapping } });
    const errors = batch.errors as { line: number; message: string }[];
    expect(errors.map((e) => e.line)).toEqual([4]);
    expect(errors[0]!.message).toMatch(/«Palco» no está emparejado/);
    expect(batch.validRows).toBe(2);
  });
});
