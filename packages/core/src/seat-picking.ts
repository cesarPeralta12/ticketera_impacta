/**
 * Ayudas para elegir butacas: no dejar un asiento suelto entre lo elegido y lo vendido (asiento huérfano, que después
 * nadie compra) y "mejor disponible" (los N juntos más cerca del escenario y del centro).
 * Puro (sin DOM): lo usan el mapa del comprador y la reserva en el servidor.
 */
import { CANVAS_WIDTH } from "./seat-geometry";

export type PickSeat = { id: string; row: string; number: string; x: number; y: number; taken: boolean };

/** Butacas de cada fila en orden (por número: 1, 2, … 10, no "1", "10", "2"). */
function rowsOf<T extends { row: string; number: string }>(seats: T[]): T[][] {
  const rows = new Map<string, T[]>();
  for (const seat of seats) rows.set(seat.row, [...(rows.get(seat.row) ?? []), seat]);
  return [...rows.values()].map((row) =>
    row.toSorted((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number)),
  );
}

/**
 * Asientos que quedarían sueltos con esta selección: libres, sin elegir, con lo elegido o vendido (o el borde de la
 * fila) a ambos lados y al menos un vecino elegido ahora (si ya estaba suelto antes, no es culpa de esta compra).
 */
export function orphanSeats(seats: PickSeat[], selected: Set<string>): PickSeat[] {
  const orphans: PickSeat[] = [];
  for (const row of rowsOf(seats)) {
    if (row.length < 3) continue;
    const busy = (i: number) => i < 0 || i >= row.length || row[i]!.taken || selected.has(row[i]!.id);
    row.forEach((seat, i) => {
      if (seat.taken || selected.has(seat.id)) return;
      const left = row[i - 1];
      const right = row[i + 1];
      const causedNow = (left && selected.has(left.id)) || (right && selected.has(right.id));
      if (busy(i - 1) && busy(i + 1) && causedNow) orphans.push(seat);
    });
  }
  return orphans;
}

/**
 * Los mejores `count` lugares juntos (en una misma fila): los más adelante y al centro, sin dejar un asiento suelto
 * si se puede. null si no hay `count` libres seguidos en ninguna fila.
 */
export function bestAvailableSeats(seats: PickSeat[], count: number, stage: { x: number; y: number } = { x: CANVAS_WIDTH / 2, y: 0 }): PickSeat[] | null {
  if (count < 1) return null;
  let best: { seats: PickSeat[]; score: number } | null = null;
  for (const row of rowsOf(seats)) {
    for (let start = 0; start + count <= row.length; start++) {
      const window = row.slice(start, start + count);
      if (window.some((s) => s.taken)) continue;
      const cx = window.reduce((sum, s) => sum + s.x, 0) / count;
      const cy = window.reduce((sum, s) => sum + s.y, 0) / count;
      // Una fila más adelante vale como unos 3 asientos de corrimiento al centro; dejar un asiento suelto, mucho más.
      const orphaned = orphanSeats(row, new Set(window.map((s) => s.id))).length;
      const score = Math.abs(cy - stage.y) * 3 + Math.abs(cx - stage.x) + orphaned * 400;
      if (!best || score < best.score) best = { seats: window, score };
    }
  }
  return best?.seats ?? null;
}
