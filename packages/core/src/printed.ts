/**
 * Entradas impresas (cálculo puro): número de serie, rangos ("del 0001 al 0020"), próximo prefijo libre y los
 * cambios de estado permitidos (en stock → entregada → vendida, devuelta o anulada).
 */

export const PRINT_STATES = ["STOCK", "ASSIGNED", "SOLD", "RETURNED", "VOID"] as const;
export type PrintStateName = (typeof PRINT_STATES)[number];

export const PRINT_STATE_LABEL: Record<PrintStateName, string> = {
  STOCK: "En stock",
  ASSIGNED: "Entregada",
  SOLD: "Vendida",
  RETURNED: "Devuelta",
  VOID: "Anulada",
};

/** Lo más que se crea en un lote (y lo que se imprime en un PDF). */
export const MAX_PRINT_BATCH = 2000;
export const PRINT_SALE_METHODS = ["EFECTIVO", "QR", "TRANSFERENCIA"] as const;
export type PrintSaleMethod = (typeof PRINT_SALE_METHODS)[number];

/** "A" + 7 → "A-0007". La serie se ve grande en la entrada y en el talón. */
export function formatSerial(prefix: string, n: number, width = 4): string {
  return `${prefix}-${String(n).padStart(width, "0")}`;
}

/** Número de una serie de un prefijo ("A-0007" → 7), o null si no es de ese prefijo. */
export function serialNumber(serial: string, prefix: string): number | null {
  const match = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`).exec(serial.trim().toUpperCase());
  return match ? Number(match[1]) : null;
}

/** Prefijo válido: 1 a 4 letras o números, en mayúsculas. */
export function normalizePrefix(value: string): string | null {
  const prefix = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,4}$/.test(prefix) ? prefix : null;
}

/** El primer prefijo de una letra que no usa ningún lote de la función: A, B, … Z, AA, AB… */
export function nextPrefix(used: string[]): string {
  const taken = new Set(used.map((p) => p.toUpperCase()));
  for (let i = 0; ; i++) {
    const prefix = i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`;
    if (!taken.has(prefix)) return prefix;
  }
}

/**
 * Rango escrito por el organizador: "5", "1-20", "0001 al 0020", "A-0003 a A-0010" (con o sin prefijo).
 * Devuelve los números (desde, hasta) o un mensaje claro.
 */
export function parseSerialRange(text: string): { ok: true; from: number; to: number } | { ok: false; error: string } {
  const numbers = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (numbers.length === 0 || numbers.length > 2) return { ok: false, error: 'Escribe un número o un rango, ej. "1-20" o "0001 al 0020".' };
  const [from, to = from] = numbers as [number, number?];
  if (from < 1 || to < from) return { ok: false, error: "El rango tiene que ir de menor a mayor (ej. 1-20)." };
  if (to - from + 1 > MAX_PRINT_BATCH) return { ok: false, error: `Como máximo ${MAX_PRINT_BATCH} entradas a la vez.` };
  return { ok: true, from, to };
}

/** Qué se puede hacer con una entrada impresa según su estado. Una usada ya no cambia. */
const TRANSITIONS: Record<PrintStateName, PrintStateName[]> = {
  STOCK: ["ASSIGNED", "SOLD", "VOID"],
  ASSIGNED: ["SOLD", "RETURNED", "STOCK", "VOID"],
  RETURNED: ["ASSIGNED", "SOLD", "STOCK", "VOID"],
  // Una vendida solo se anula (con devolución del dinero por fuera).
  SOLD: ["VOID"],
  VOID: [],
};

export function canMovePrinted(from: PrintStateName, to: PrintStateName, used = false): boolean {
  return !used && TRANSITIONS[from].includes(to);
}

/**
 * ¿Abre la puerta? En modo "activada al vender" solo la vendida; en "válida al imprimir", cualquiera que no esté
 * anulada.
 */
export function printedOpensDoor(mode: "VALID_ON_PRINT" | "ACTIVATE_ON_SALE", state: PrintStateName): boolean {
  if (state === "VOID") return false;
  return mode === "VALID_ON_PRINT" || state === "SOLD";
}
