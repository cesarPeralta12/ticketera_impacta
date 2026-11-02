/**
 * Importar un Excel con cualquier formato: en vez de exigir la plantilla de iPass, se elige qué columna es cada dato.
 * Sirve sobre todo para cargar entradas que ya existen (vendidas por un tercero) con su propio código. Aquí se resume
 * cada columna, se sugiere el emparejamiento y se arman las filas; la función, el tipo, la butaca y el cupo se revisan
 * después contra el evento, igual que con la plantilla.
 */
import { DEFAULT_CODE_RULE, LONG_NUMBER_MARK, looksLikeMangledNumber, normalizeExternalCode, type ExternalCodeRule } from "./external-codes";
import { MAX_IMPORT_ROWS, importColumnOf, normalizeText, parseImportAmount, type ImportIssue, type ImportRow } from "./import-tickets";

export const MAPPABLE_FIELDS = ["code", "name", "document", "email", "place", "amount", "session", "type"] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];

export const FIELD_LABEL: Record<MappableField, string> = {
  code: "Código de la entrada",
  name: "Nombre",
  document: "Carnet",
  email: "Correo",
  place: "Butaca o mesa",
  amount: "Monto cobrado",
  session: "Función",
  type: "Tipo de entrada",
};

/** Qué columna es cada dato, y lo que vale para todas las filas cuando el archivo no tiene esa columna. */
export type ImportMapping = {
  /** Fila de títulos (0 = la primera). */
  headerRow: number;
  /** Columna de cada dato (0 = la primera). */
  columns: Partial<Record<MappableField, number>>;
  /** Un solo valor para todas las filas: la función (su nombre en la lista) o el tipo de entrada (su nombre). */
  fixed: { session?: string; type?: string };
  /** Cada valor del archivo (como lo da `valueKey`) → la función o el tipo de entrada de iPass. */
  values: { session?: Record<string, string>; type?: Record<string, string> };
  codeRule: ExternalCodeRule;
};

/** Clave para emparejar un valor escrito en el archivo: sin distinguir mayúsculas, tildes ni espacios de más. */
export const valueKey = (value: string) => normalizeText(value);

const cellText = (value: string | undefined) => (value ?? "").replace(LONG_NUMBER_MARK, "").trim();
const isEmptyRow = (row: string[]) => row.every((cell) => cellText(cell) === "");

/** La fila de títulos: la primera con al menos dos celdas llenas (a veces arriba hay un título o la fecha). */
export function detectHeaderRow(table: string[][]): number {
  const index = table.findIndex((row) => row.filter((cell) => cellText(cell) !== "").length >= 2);
  return index < 0 ? Math.max(0, table.findIndex((row) => !isEmptyRow(row))) : index;
}

/** Letra de una columna de Excel: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

export type ColumnSummary = {
  index: number;
  title: string;
  /** Las primeras celdas llenas, para reconocerla. */
  samples: string[];
  /** Valores distintos con cuántas filas tiene cada uno (los primeros `maxDistinct`). */
  distinct: { value: string; count: number }[];
  distinctCount: number;
  filled: number;
};

/** Un resumen de cada columna debajo de la fila de títulos: su título, ejemplos y sus valores distintos. */
export function summarizeColumns(table: string[][], headerRow: number, maxDistinct = 60): ColumnSummary[] {
  const header = table[headerRow] ?? [];
  const body = table.slice(headerRow + 1).filter((row) => !isEmptyRow(row));
  const width = Math.max(header.length, ...body.map((row) => row.length), 0);
  return Array.from({ length: width }, (_, index) => {
    const counts = new Map<string, { value: string; count: number }>();
    const samples: string[] = [];
    let filled = 0;
    for (const row of body) {
      const value = cellText(row[index]);
      if (!value) continue;
      filled++;
      if (samples.length < 3) samples.push(value);
      const key = valueKey(value);
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { value, count: 1 });
    }
    const title = cellText(header[index]) || `Columna ${columnLetter(index)}`;
    return { index, title, samples, distinct: [...counts.values()].slice(0, maxDistinct), distinctCount: counts.size, filled };
  }).filter((c) => c.filled > 0 || cellText(header[c.index]) !== "");
}

/** Títulos con los que suele venir el código de una entrada. */
const CODE_TITLES = [
  "codigo",
  "codigo de entrada",
  "codigo entrada",
  "code",
  "qr",
  "codigo qr",
  "ticket",
  "ticket id",
  "id ticket",
  "nro de entrada",
  "numero de entrada",
  "n de entrada",
  "id",
  "serial",
  "serie",
  "barcode",
  "codigo de barras",
  "localizador",
  "boleto",
  "nro de boleto",
];

/**
 * Qué columna parece cada dato: por el título (los nombres de la plantilla y parecidos) y, para el código, por la forma
 * de los valores (una columna sin repetidos y sin espacios, casi siempre llena). Es solo una sugerencia: se corrige a mano.
 */
export function suggestMapping(columns: ColumnSummary[]): Partial<Record<MappableField, number>> {
  const mapping: Partial<Record<MappableField, number>> = {};
  const taken = new Set<number>();
  const assign = (field: MappableField, index: number) => {
    if (mapping[field] === undefined && !taken.has(index)) {
      mapping[field] = index;
      taken.add(index);
    }
  };
  for (const column of columns) {
    const title = valueKey(column.title).replace(/[.:#°º*]/g, "").replace(/\s+/g, " ").trim();
    if (CODE_TITLES.includes(title)) assign("code", column.index);
  }
  for (const column of columns) {
    const field = importColumnOf(column.title);
    if (field) assign(field, column.index);
  }
  if (mapping.code === undefined) {
    const most = Math.max(0, ...columns.map((c) => c.filled));
    const candidate = columns.find(
      (c) => !taken.has(c.index) && c.filled > 0 && c.filled >= most * 0.8 && c.distinctCount === c.filled && c.samples.every((s) => !/\s/.test(s)),
    );
    if (candidate) assign("code", candidate.index);
  }
  return mapping;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Las filas del archivo con el emparejamiento elegido → filas para importar y errores por fila. Revisa lo mismo que
 * la plantilla (correo, monto, carnet repetido) y además el código: que no se repita en el archivo y que Excel no lo
 * haya redondeado. Una fila sin código recibe uno propio de iPass al confirmar.
 */
export function parseMappedTable(table: string[][], mapping: ImportMapping): { rows: ImportRow[]; errors: ImportIssue[]; total: number } {
  const rule = mapping.codeRule ?? DEFAULT_CODE_RULE;
  const rows: ImportRow[] = [];
  const errors: ImportIssue[] = [];
  const documents = new Map<string, number>();
  const codes = new Map<string, number>();
  let total = 0;
  for (let index = mapping.headerRow + 1; index < table.length; index++) {
    const cells = table[index]!;
    if (isEmptyRow(cells)) continue;
    total++;
    const line = index + 1;
    if (total > MAX_IMPORT_ROWS) continue;
    const raw = (field: MappableField) => {
      const column = mapping.columns[field];
      return column === undefined ? "" : (cells[column] ?? "").trim();
    };
    const cell = (field: MappableField) => cellText(raw(field));
    const problems: string[] = [];

    // El valor de la fila emparejado con iPass, o el que vale para todas.
    const pick = (field: "session" | "type") => {
      if (mapping.columns[field] === undefined) return mapping.fixed[field] ?? "";
      const value = cell(field);
      if (!value) return mapping.fixed[field] ?? "";
      const matched = mapping.values[field]?.[valueKey(value)];
      if (!matched) problems.push(`${field === "type" ? "el tipo" : "la función"} «${value}» no está emparejado con iPass`);
      return matched ?? "";
    };
    const session = pick("session");
    const before = problems.length;
    const type = pick("type");
    if (!type && problems.length === before) problems.push("falta el tipo de entrada");

    const name = cell("name").replace(/\s+/g, " ") || "Sin nombre";
    const email = cell("email").toLowerCase();
    const document = cell("document").replace(/\s+/g, " ");
    const amount = parseImportAmount(cell("amount"));
    if (email && !EMAIL.test(email)) problems.push(`correo inválido (${email})`);
    if (amount === null) problems.push(`monto inválido (${cell("amount")}): usa solo números, ej. 150 o 150,50`);
    if (document) {
      const key = normalizeText(document).replace(/[^a-z0-9]/g, "");
      const previous = documents.get(key);
      if (previous !== undefined) problems.push(`el carnet ${document} está repetido (fila ${previous})`);
      else documents.set(key, line);
    }

    let externalCode: string | null = null;
    let externalKey: string | null = null;
    const code = raw("code");
    if (mapping.columns.code !== undefined && code) {
      if (looksLikeMangledNumber(code)) {
        problems.push(`el código ${cellText(code)} es un número de más de 15 dígitos y Excel ya lo redondeó: en el archivo original, formatea esa columna como texto`);
      } else {
        externalKey = normalizeExternalCode(code, rule);
        if (!externalKey) problems.push(`el código «${code.slice(0, 40)}» no se puede leer`);
        else {
          const previous = codes.get(externalKey);
          if (previous !== undefined) problems.push(`el código ${code} está repetido (fila ${previous})`);
          else {
            codes.set(externalKey, line);
            externalCode = code;
          }
        }
      }
    }

    if (problems.length > 0) {
      errors.push({ line, message: capitalize(problems.join("; ")) + "." });
      continue;
    }
    rows.push({
      line,
      session,
      type,
      name,
      document: document || null,
      email: email || null,
      place: cell("place") || null,
      amount: amount ?? 0,
      externalCode,
      externalKey,
    });
  }
  if (total > MAX_IMPORT_ROWS) {
    errors.unshift({ line: 1, message: `Máximo ${MAX_IMPORT_ROWS} filas por archivo (este tiene ${total}): divídelo en varios.` });
  }
  return { rows, errors, total };
}
