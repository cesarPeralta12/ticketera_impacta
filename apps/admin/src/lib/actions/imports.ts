"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import readXlsxFile, { readSheet } from "read-excel-file/universal";
import {
  LONG_NUMBER_MARK,
  MAPPABLE_FIELDS,
  detectHeaderRow,
  excelNumberText,
  parseCodeRule,
  parseDelimited,
  parseImportTable,
  parseMappedTable,
  suggestMapping,
  summarizeColumns,
  type ColumnSummary,
  type ImportMapping,
  type MappableField,
} from "@ticketera/core";
import {
  DomainError,
  confirmImport,
  createImportDraft,
  deleteImportFormat,
  discardImport,
  importOrdersToEmail,
  markTicketsEmailed,
  prisma,
  saveImportFormat,
  undoImport,
} from "@ticketera/db";
import { type FormState } from "@/lib/forms";
import { sendOrderTicketsEmail } from "@/lib/mail";
import { requireEditor, visibleEvent, type Staff } from "@/lib/session";
import { logAudit } from "@/lib/audit";

const MAX_FILE_BYTES = 5_000_000;
/** Correos por clic: cada uno lleva sus QR; el resto se envía con otro clic ("enviar los que faltan"). */
const EMAILS_PER_RUN = 50;

/** Importación de un evento que este usuario administra. */
async function ownBatch(staff: Staff, batchId: string) {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || !(await visibleEvent(staff, batch.eventId))) return null;
  return batch;
}

const batchPath = (batch: { id: string; eventId: string }) => `/eventos/${batch.eventId}/importar/${batch.id}`;

/** Celdas de Excel como texto: la fecha como 2026-11-20 y los números tal cual (150.5). */
function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell);
}

/** Paso 2: sube el archivo y lo revisa entero. Queda en borrador (sin ocupar cupo) y se abre la vista previa. */
export async function uploadImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const event = await visibleEvent(staff, String(formData.get("eventId") ?? ""));
  if (!event) return { error: "Evento no encontrado." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Elige el archivo de Excel (.xlsx) o CSV." } };
  if (file.size > MAX_FILE_BYTES) return { fieldErrors: { file: "El archivo supera 5 MB." } };
  if (/\.xls$/i.test(file.name)) {
    return { fieldErrors: { file: "Es un Excel antiguo (.xls): en Excel usa Archivo → Guardar como → Libro de Excel (.xlsx)." } };
  }

  let table: string[][];
  if (/\.xlsx$/i.test(file.name)) {
    const data = await file.arrayBuffer();
    try {
      // La hoja "Entradas" de la plantilla; si el archivo es otro, su primera hoja.
      const sheet = await readSheet(data, "Entradas").catch(() => readSheet(data));
      table = sheet.map((row) => row.map(cellText));
    } catch {
      return { fieldErrors: { file: "No se pudo leer el Excel. Revisa que sea un .xlsx válido." } };
    }
  } else if (/\.(csv|txt)$/i.test(file.name)) {
    table = parseDelimited(await file.text());
  } else {
    return { fieldErrors: { file: "Sube la plantilla en Excel (.xlsx) o un CSV." } };
  }

  const parsed = parseImportTable(table);
  if (parsed.total === 0) return { fieldErrors: { file: parsed.errors[0]?.message ?? "El archivo no tiene filas para importar." } };
  const batch = await createImportDraft({ eventId: event.id, staffId: staff.id, fileName: file.name, parsed });
  await logAudit({
    actorType: "staff",
    actorId: staff.id,
    action: "import.upload",
    entity: "ImportBatch",
    entityId: batch.id,
    data: { rows: batch.totalRows, valid: batch.validRows },
  });
  redirect(batchPath(batch));
}

/** Un archivo subido como tabla de texto: la hoja elegida de un Excel (con los números tal como están guardados) o un CSV. */
async function readUploadedTable(file: unknown, sheet?: string): Promise<{ table: string[][]; sheets: string[]; sheet: string } | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return { error: "Elige el archivo de Excel (.xlsx) o CSV." };
  if (file.size > MAX_FILE_BYTES) return { error: "El archivo supera 5 MB." };
  if (/\.xls$/i.test(file.name)) return { error: "Es un Excel antiguo (.xls): en Excel usa Archivo → Guardar como → Libro de Excel (.xlsx)." };
  if (/\.xlsx$/i.test(file.name)) {
    try {
      // Los números como texto: un código 00123 guardado como texto queda igual, y uno largo guardado como número se marca.
      const sheets = await readXlsxFile<string>(await file.arrayBuffer(), { parseNumber: excelNumberText });
      const chosen = sheets.find((s) => s.sheet === sheet) ?? sheets[0];
      if (!chosen) return { error: "El Excel no tiene hojas." };
      return { table: chosen.data.map((row) => row.map(cellText)), sheets: sheets.map((s) => s.sheet), sheet: chosen.sheet };
    } catch {
      return { error: "No se pudo leer el Excel. Revisa que sea un .xlsx válido." };
    }
  }
  if (/\.(csv|txt)$/i.test(file.name)) return { table: parseDelimited(await file.text()), sheets: [], sheet: "" };
  return { error: "Sube un Excel (.xlsx) o un CSV." };
}

export type ExternalFileAnalysis =
  | { error: string }
  | {
      fileName: string;
      sheets: string[];
      sheet: string;
      headerRow: number;
      /** Filas con datos debajo de los títulos. */
      rowCount: number;
      /** Las primeras filas del archivo, para ver la de títulos y unos ejemplos. */
      preview: string[][];
      columns: ColumnSummary[];
      suggested: Partial<Record<MappableField, number>>;
    };

/**
 * Entradas que ya existen (de otro proveedor): lee el archivo y devuelve sus columnas, con ejemplos, valores distintos
 * y qué parece cada una. No guarda nada: el emparejamiento se elige en la ventana y se envía con el archivo.
 */
export async function analyzeExternalFileAction(formData: FormData): Promise<ExternalFileAnalysis> {
  const staff = await requireEditor();
  const event = await visibleEvent(staff, String(formData.get("eventId") ?? ""));
  if (!event) return { error: "Evento no encontrado." };
  const read = await readUploadedTable(formData.get("file"), String(formData.get("sheet") ?? "") || undefined);
  if ("error" in read) return read;
  const { table } = read;
  if (table.every((row) => row.every((cell) => cell.trim() === ""))) return { error: "El archivo está vacío." };
  const requested = Number(formData.get("headerRow"));
  const headerRow = formData.get("headerRow") !== null && Number.isInteger(requested) && requested >= 0 && requested < table.length ? requested : detectHeaderRow(table);
  const columns = summarizeColumns(table, headerRow);
  const file = formData.get("file") as File;
  return {
    fileName: file.name,
    sheets: read.sheets,
    sheet: read.sheet,
    headerRow,
    rowCount: table.slice(headerRow + 1).filter((row) => row.some((cell) => cell.trim() !== "")).length,
    preview: table.slice(0, Math.max(headerRow + 6, 10)).map((row) => row.slice(0, 40).map((cell) => cell.replace(LONG_NUMBER_MARK, "").slice(0, 80))),
    columns,
    suggested: suggestMapping(columns),
  };
}

/** El emparejamiento que manda la ventana, revisado: columnas que existen, textos y la regla del código. */
function readMapping(raw: string, width: number, rows: number): ImportMapping | null {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof input !== "object" || input === null) return null;
  const m = input as Record<string, unknown>;
  const headerRow = Number(m.headerRow);
  if (!Number.isInteger(headerRow) || headerRow < 0 || headerRow >= rows) return null;
  const columns: ImportMapping["columns"] = {};
  const given = (typeof m.columns === "object" && m.columns) || {};
  for (const field of MAPPABLE_FIELDS) {
    const index = (given as Record<string, unknown>)[field];
    if (index === undefined || index === null || index === "") continue;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= width) return null;
    columns[field] = index as number;
  }
  const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 200) : undefined);
  const record = (value: unknown) =>
    typeof value === "object" && value !== null
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "string" && v ? [[k.slice(0, 200), v.slice(0, 200)]] : [])))
      : undefined;
  const fixed = (typeof m.fixed === "object" && m.fixed) || {};
  const values = (typeof m.values === "object" && m.values) || {};
  return {
    headerRow,
    columns,
    fixed: { session: text((fixed as Record<string, unknown>).session), type: text((fixed as Record<string, unknown>).type) },
    values: { session: record((values as Record<string, unknown>).session), type: record((values as Record<string, unknown>).type) },
    codeRule: parseCodeRule(m.codeRule),
  };
}

/** Entradas de otro proveedor: con el archivo y el emparejamiento, arma el borrador y abre la revisión por fila. */
export async function createExternalImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const event = await visibleEvent(staff, String(formData.get("eventId") ?? ""));
  if (!event) return { error: "Evento no encontrado." };
  const read = await readUploadedTable(formData.get("file"), String(formData.get("sheet") ?? "") || undefined);
  if ("error" in read) return { error: read.error };
  const width = Math.max(0, ...read.table.map((row) => row.length));
  const mapping = readMapping(String(formData.get("mapping") ?? ""), width, read.table.length);
  if (!mapping) return { error: "El emparejamiento de columnas no es válido: vuelve a elegir las columnas." };
  if (mapping.columns.code === undefined) return { error: "Elige qué columna es el código de la entrada." };
  if (mapping.columns.type === undefined && !mapping.fixed.type) return { error: "Elige qué columna es el tipo de entrada, o un tipo para todas." };
  const readMethod = formData.get("readMethod") === "BARCODE" ? "BARCODE" : "QR";
  const sourceName = String(formData.get("sourceName") ?? "").trim().slice(0, 80) || null;

  const parsed = parseMappedTable(read.table, mapping);
  if (parsed.total === 0) return { error: "El archivo no tiene filas debajo de la fila de títulos." };
  const file = formData.get("file") as File;
  const batch = await createImportDraft({
    eventId: event.id,
    staffId: staff.id,
    fileName: file.name,
    parsed,
    external: { sourceName, codeRule: mapping.codeRule, readMethod, mapping: { ...mapping, sheet: read.sheet } },
  });
  await logAudit({
    actorType: "staff",
    actorId: staff.id,
    action: "import.upload",
    entity: "ImportBatch",
    entityId: batch.id,
    data: { rows: batch.totalRows, valid: batch.validRows, external: true, source: sourceName },
  });
  redirect(batchPath(batch));
}

/** Paso 3: confirma. Todo o nada: con una sola fila con error no se emite ninguna entrada. */
export async function confirmImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const batch = await ownBatch(staff, String(formData.get("batchId") ?? ""));
  if (!batch) return { error: "Importación no encontrada." };
  try {
    await confirmImport({ batchId: batch.id, staffId: staff.id, overCapacity: formData.get("overCapacity") === "on" });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/eventos/${batch.eventId}`);
  redirect(batchPath(batch));
}

export async function discardImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const batch = await ownBatch(staff, String(formData.get("batchId") ?? ""));
  if (!batch) return { error: "Importación no encontrada." };
  try {
    await discardImport({ batchId: batch.id, staffId: staff.id });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  redirect(`/eventos/${batch.eventId}/importar`);
}

/** Deshace el lote: anula las entradas que no se usaron y libera su cupo. */
export async function undoImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const batch = await ownBatch(staff, String(formData.get("batchId") ?? ""));
  if (!batch) return { error: "Importación no encontrada." };
  if (formData.get("confirm") !== "on") return { fieldErrors: { confirm: "Marca la casilla para confirmar que quieres anular estas entradas." } };
  try {
    const result = await undoImport({ batchId: batch.id, staffId: staff.id });
    revalidatePath(batchPath(batch));
    return {
      ok: true,
      message: `Se anularon ${result.cancelled} entrada(s).${result.used ? ` ${result.used} ya habían entrado y quedan como usadas.` : ""}`,
    };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

/** Envía las entradas por correo a quienes tienen correo y todavía no las recibieron (de a tandas). */
export async function emailImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const batch = await ownBatch(staff, String(formData.get("batchId") ?? ""));
  if (!batch) return { error: "Importación no encontrada." };
  if (batch.status !== "CONFIRMED") return { error: "Primero confirma la importación." };
  const orders = await importOrdersToEmail(batch.id, EMAILS_PER_RUN);
  if (orders.length === 0) return { ok: true, message: "No queda nadie por enviar." };
  const sent: string[] = [];
  let failed = 0;
  for (const order of orders) {
    if (await sendOrderTicketsEmail(order.code)) sent.push(order.id);
    else failed++;
  }
  await markTicketsEmailed(sent);
  await logAudit({ actorType: "staff", actorId: staff.id, action: "import.email", entity: "ImportBatch", entityId: batch.id, data: { sent: sent.length, failed } });
  revalidatePath(batchPath(batch));
  if (sent.length === 0) return { error: "No se pudo enviar ningún correo. Revisa la configuración del correo e inténtalo de nuevo." };
  return { ok: true, message: `Se enviaron ${sent.length} correo(s).${failed ? ` ${failed} fallaron: vuelve a intentarlo.` : ""}` };
}

/** Guarda el emparejamiento actual como formato de la organización, para repetirlo con el mismo proveedor. */
export async function saveImportFormatAction(formData: FormData): Promise<{ error: string } | { ok: true }> {
  const staff = await requireEditor();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Ponle un nombre al formato." };
  const mapping = readMapping(String(formData.get("mapping") ?? ""), 1000, 1_000_000);
  if (!mapping) return { error: "El emparejamiento no es válido." };
  const rawTitles = (() => {
    try {
      return JSON.parse(String(formData.get("titles") ?? "{}")) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const titles = Object.fromEntries(
    MAPPABLE_FIELDS.flatMap((field) => (mapping.columns[field] !== undefined && typeof rawTitles[field] === "string" ? [[field, (rawTitles[field] as string).slice(0, 200)]] : [])),
  );
  await saveImportFormat({
    organizationId: staff.organization.id,
    name,
    sourceName: String(formData.get("sourceName") ?? "").trim().slice(0, 80) || null,
    readMethod: formData.get("readMethod") === "BARCODE" ? "BARCODE" : "QR",
    mapping,
    titles,
  });
  revalidatePath("/eventos", "layout");
  return { ok: true };
}

export async function deleteImportFormatAction(formData: FormData): Promise<{ ok: true }> {
  const staff = await requireEditor();
  await deleteImportFormat(staff.organization.id, String(formData.get("id") ?? ""));
  revalidatePath("/eventos", "layout");
  return { ok: true };
}

/**
 * Crea desde el asistente el tipo de entrada para lo importado, en cada función activa del evento (con el mismo nombre y
 * en la sección general elegida). Queda cerrado a la venta en la web: solo recibe entradas por importación.
 */
export async function createImportTypeAction(formData: FormData): Promise<{ error: string } | { ok: true; name: string }> {
  const staff = await requireEditor();
  const event = await visibleEvent(staff, String(formData.get("eventId") ?? ""));
  if (!event) return { error: "Evento no encontrado." };
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const sectionName = String(formData.get("section") ?? "");
  const capacity = Number(formData.get("capacity"));
  if (name.length < 2) return { error: "Ponle un nombre al tipo de entrada." };
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100_000) return { error: "El cupo debe ser un número entero de 1 en adelante." };
  const sessions = await prisma.eventSession.findMany({
    where: { eventId: event.id, cancelledAt: null },
    orderBy: { startsAt: "asc" },
    select: { id: true, venue: { select: { id: true, sections: { select: { id: true, name: true, seatingMode: true, capacity: true } } } }, ticketTypes: { select: { name: true } } },
  });
  if (sessions.length === 0) return { error: "El evento no tiene funciones activas." };
  const wanted = sessions.map((s) => ({ session: s, section: s.venue.sections.find((x) => x.name === sectionName) }));
  for (const { session, section } of wanted) {
    if (session.ticketTypes.some((t) => t.name.toLowerCase() === name.toLowerCase())) return { error: `Ya existe un tipo de entrada llamado "${name}".` };
    if (!section || section.seatingMode !== "GENERAL_ADMISSION") return { error: `Elige una sección general que exista en todas las funciones.` };
    if (capacity > section.capacity) return { error: `"${section.name}" admite como máximo ${section.capacity} personas.` };
  }
  const closed = new Date(Date.now() - 60_000);
  await prisma.$transaction(
    wanted.map(({ session, section }) =>
      prisma.ticketType.create({
        data: {
          sessionId: session.id,
          sectionId: section!.id,
          name,
          unitAmount: 0,
          currency: staff.organization.currency,
          capacity,
          maxPerOrder: 1,
          salesEndAt: closed,
          accessMethods: ["QR", "BARCODE"],
          sortOrder: session.ticketTypes.length,
        },
      }),
    ),
  );
  await logAudit({ actorType: "staff", actorId: staff.id, action: "import.type.create", entity: "Event", entityId: event.id, data: { name, capacity, sessions: sessions.length } });
  revalidatePath(`/eventos/${event.id}/importar`);
  return { ok: true, name };
}
