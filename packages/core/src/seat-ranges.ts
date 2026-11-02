/**
 * Rangos de butacas escritos a mano ("A 1-20, 40-50"): se convierten en qué butacas del mapa quedan elegidas.
 * Cada elemento va separado por coma, punto y coma o salto de línea. Puede llevar delante la fila, la sección o ambas
 * ("Platea B 5-9"); sin nada delante, vale para todas las filas y secciones.
 */
import { normalizeText } from "./import-tickets";

export type RangeSeat = { id: string; section: string; row: string; number: string };

export type SeatRangeItem = { text: string; prefix: string; from: number; to: number };

const key = (value: string) => normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();

/** Cada elemento del texto con su prefijo y su rango; los que no se entienden quedan en `invalid`. */
export function parseSeatRanges(input: string): { items: SeatRangeItem[]; invalid: string[] } {
  const items: SeatRangeItem[] = [];
  const invalid: string[] = [];
  for (const raw of input.split(/[,;\n]+/)) {
    const text = raw.trim();
    if (!text) continue;
    const match = /^(.*?)(\d+)\s*(?:-|–|—|\ba\b|\bal\b|\.\.)\s*(\d+)$/i.exec(text) ?? /^(.*?)(\d+)$/.exec(text);
    if (!match) {
      invalid.push(text);
      continue;
    }
    const from = Number(match[2]);
    const to = match[3] === undefined ? from : Number(match[3]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      invalid.push(text);
      continue;
    }
    // «Fila A 1-20» y «A: 1-20» dan el mismo prefijo; el guion que separa fila y número no es un rango.
    const prefix = key((match[1] ?? "").replace(/[:·\-–—]+\s*$/, ""));
    items.push({ text, prefix, from: Math.min(from, to), to: Math.max(from, to) });
  }
  return { items, invalid };
}

/** Las butacas que cubre el texto y los elementos que no encontraron ninguna (para avisar cuál está mal escrito). */
export function resolveSeatRanges(input: string, seats: RangeSeat[]): { ids: string[]; empty: string[]; invalid: string[] } {
  const { items, invalid } = parseSeatRanges(input);
  const ids = new Set<string>();
  const empty: string[] = [];
  for (const item of items) {
    const words = item.prefix.split(" ").filter((w) => w && w !== "fila" && w !== "mesa" && w !== "butaca" && w !== "asiento");
    const prefix = words.join(" ");
    let found = 0;
    for (const seat of seats) {
      const number = Number(seat.number);
      if (!Number.isFinite(number) || number < item.from || number > item.to) continue;
      const row = key(seat.row);
      const section = key(seat.section);
      const ok = !prefix || prefix === row || prefix === section || prefix === `${section} ${row}` || prefix === `${row} ${section}`;
      if (!ok) continue;
      ids.add(seat.id);
      found++;
    }
    if (found === 0) empty.push(item.text);
  }
  return { ids: [...ids], empty, invalid };
}
