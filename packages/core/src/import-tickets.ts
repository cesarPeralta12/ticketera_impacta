/**
 * Importar entradas desde Excel o CSV: para lo vendido por otro medio o para invitar sin pasar por la web. Aquí se lee
 * la planilla (una persona o una mesa por fila) y se revisa lo que no depende de la base de datos; la función, el tipo
 * de entrada, la butaca y el cupo se revisan al armar el lote.
 */
import { utcToZonedInput } from "./locale";

export const MAX_IMPORT_ROWS = 5000;

export const IMPORT_COLUMNS = [
  { key: "session", header: "Función", note: "Elige de la lista. Si el evento tiene una sola función, puedes dejarla vacía." },
  { key: "type", header: "Tipo de entrada", note: "Elige de la lista (el nombre tal como está en el evento)." },
  { key: "name", header: "Nombre", note: "Obligatorio: nombre y apellido de quien entra." },
  { key: "document", header: "Carnet", note: "Opcional. No puede repetirse en el archivo." },
  { key: "email", header: "Correo", note: "Opcional. Si está, se le pueden enviar las entradas por correo." },
  { key: "place", header: "Butaca o mesa", note: "Solo en zonas numeradas (ej. F-12) o mesas (ej. Mesa 5). En entrada general, vacío." },
  { key: "amount", header: "Monto cobrado (Bs)", note: "Opcional: lo que se cobró por fuera (ej. 150). Vacío = 0 (cortesía)." },
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number]["key"];

export type ImportRow = {
  /** Fila en la planilla (la de títulos es la 1), para señalar el error donde la persona lo ve. */
  line: number;
  session: string;
  type: string;
  name: string;
  document: string | null;
  email: string | null;
  place: string | null;
  /** Centavos. */
  amount: number;
};

export type ImportIssue = { line: number; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const ALIASES: Record<ImportColumn, string[]> = {
  session: ["funcion", "fecha", "dia", "fecha y hora"],
  type: ["tipo de entrada", "tipo", "entrada", "sector", "categoria", "localidad"],
  name: ["nombre", "nombres", "nombre completo", "nombre y apellido", "titular", "invitado", "asistente"],
  document: ["carnet", "ci", "c.i.", "c.i", "documento", "dni", "cedula", "carnet de identidad", "nro de carnet"],
  email: ["correo", "email", "e-mail", "mail", "correo electronico"],
  place: ["butaca o mesa", "butaca", "asiento", "mesa", "lugar", "ubicacion"],
  amount: ["monto cobrado (bs)", "monto cobrado", "monto", "precio", "pagado", "importe", "monto (bs)", "precio (bs)"],
};

function columnOf(header: string): ImportColumn | null {
  const clean = normalizeText(header).replace(/\*$/, "").replace(/\(opcional\)/, "").trim();
  for (const [key, names] of Object.entries(ALIASES) as [ImportColumn, string[]][]) {
    if (names.includes(clean)) return key;
  }
  return null;
}

/** "150", "150,50", "1.500", "1.500,50" o "Bs 150" → centavos. null si no es un monto. */
export function parseImportAmount(raw: string): number | null {
  let value = raw.replace(/bs\.?/i, "").replace(/\s/g, "");
  if (value === "") return 0;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(value)) value = value.replace(/\./g, "");
  value = value.replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}

/**
 * Filas de la planilla (la primera con los títulos) → filas para importar y errores por fila. Las columnas se
 * reconocen por su título (en cualquier orden y con nombres parecidos: "CI", "Email", "Mesa"…).
 */
export function parseImportTable(table: string[][]): { rows: ImportRow[]; errors: ImportIssue[]; total: number } {
  const headerIndex = table.findIndex((row) => row.some((cell) => cell.trim() !== ""));
  if (headerIndex < 0) return { rows: [], errors: [{ line: 1, message: "El archivo está vacío." }], total: 0 };
  const columns = new Map<ImportColumn, number>();
  table[headerIndex]!.forEach((cell, i) => {
    const key = columnOf(cell);
    if (key && !columns.has(key)) columns.set(key, i);
  });
  if (!columns.has("name") || !columns.has("type")) {
    return {
      rows: [],
      errors: [{ line: headerIndex + 1, message: "La primera fila debe tener los títulos de la plantilla (al menos Tipo de entrada y Nombre)." }],
      total: 0,
    };
  }

  const rows: ImportRow[] = [];
  const errors: ImportIssue[] = [];
  const documents = new Map<string, number>();
  let total = 0;
  for (let index = headerIndex + 1; index < table.length; index++) {
    const cells = table[index]!;
    if (cells.every((cell) => cell.trim() === "")) continue;
    total++;
    const line = index + 1;
    if (total > MAX_IMPORT_ROWS) continue;
    const cell = (key: ImportColumn) => {
      const i = columns.get(key);
      return i === undefined ? "" : (cells[i] ?? "").trim();
    };
    const name = cell("name").replace(/\s+/g, " ");
    const email = cell("email").toLowerCase();
    const document = cell("document").replace(/\s+/g, " ");
    const amount = parseImportAmount(cell("amount"));
    const problems: string[] = [];
    if (name.length < 2) problems.push("falta el nombre");
    if (!cell("type")) problems.push("falta el tipo de entrada");
    if (email && !EMAIL.test(email)) problems.push(`correo inválido (${email})`);
    if (amount === null) problems.push(`monto inválido (${cell("amount")}): usa solo números, ej. 150 o 150,50`);
    if (document) {
      const key = normalizeText(document).replace(/[^a-z0-9]/g, "");
      const previous = documents.get(key);
      if (previous !== undefined) problems.push(`el carnet ${document} está repetido (fila ${previous})`);
      else documents.set(key, line);
    }
    if (problems.length > 0) {
      errors.push({ line, message: capitalize(problems.join("; ")) + "." });
      continue;
    }
    rows.push({
      line,
      session: cell("session"),
      type: cell("type"),
      name,
      document: document || null,
      email: email || null,
      place: cell("place") || null,
      amount: amount ?? 0,
    });
  }
  if (total > MAX_IMPORT_ROWS) {
    errors.unshift({ line: 1, message: `Máximo ${MAX_IMPORT_ROWS} filas por archivo (este tiene ${total}): divídelo en varios.` });
  }
  return { rows, errors, total };
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * CSV de Excel en español (punto y coma), con coma o con tabuladores (pegado). Respeta las comillas: un nombre
 * "Pérez; Juan" no se parte en dos columnas.
 */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const separator = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]!;
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Cómo se nombra cada función en la plantilla: "1. vie, 20 nov 2026, 20:00 · Teatro". El número la identifica. */
export function importSessionLabel(index: number, when: string, venueName: string) {
  return `${index + 1}. ${when} · ${venueName}`;
}

/**
 * La función que corresponde a lo escrito en la columna "Función": el texto de la lista, su número ("1", "2."), la
 * fecha ("2026-11-20", si ese día hay una sola) o vacío si el evento tiene una sola función.
 */
export function matchImportSession<T extends { label: string; startsAt: Date; timeZone: string }>(value: string, sessions: T[]): T | null {
  const text = value.trim();
  if (text === "") return sessions.length === 1 ? sessions[0]! : null;
  const exact = sessions.find((s) => normalizeText(s.label) === normalizeText(text));
  if (exact) return exact;
  const numbered = /^(\d{1,3})\s*(?:[.)\-]|$)/.exec(text);
  if (numbered && !/^\d{4}-/.test(text)) return sessions[Number(numbered[1]) - 1] ?? null;
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
  if (date) {
    const sameDay = sessions.filter((s) => utcToZonedInput(s.startsAt, s.timeZone).slice(0, 10) === date);
    return sameDay.length === 1 ? sameDay[0]! : null;
  }
  return null;
}

const PLACE_WORDS = new Set(["fila", "asiento", "butaca", "silla", "mesa", "lounge", "nro", "numero"]);

/**
 * Clave para comparar una butaca o mesa escrita a mano con la del mapa: "Fila F · 12", "F-12", "f12" y "F 12" dan
 * "f-12"; "Mesa 5" y "5" dan "5".
 */
export function placeKey(value: string): string {
  return (normalizeText(value).match(/[a-z]+|\d+/g) ?? []).filter((token) => !PLACE_WORDS.has(token)).join("-");
}
