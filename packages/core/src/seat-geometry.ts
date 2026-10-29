/**
 * Cálculo de posiciones de butacas para el editor visual de mapas de asientos.
 * Puro (sin DOM): lo usan el editor del panel (vista previa en vivo), la acción del
 * servidor que guarda las butacas, el mapa del comprador y la semilla de datos.
 *
 * Todas las secciones de un recinto comparten un lienzo de CANVAS_WIDTH × CANVAS_HEIGHT.
 */

export type GridShape = {
  type: "grid";
  rows: number;
  seatsPerRow: number;
  x: number; // esquina superior-izquierda
  y: number;
  seatGap: number;
  rowGap: number;
};

export type ArcShape = {
  type: "arc";
  rows: number;
  seatsPerRow: number;
  centerX: number;
  centerY: number;
  startRadius: number;
  rowGap: number;
  startAngleDeg: number; // 0° = derecha, 90° = abajo (eje Y crece hacia abajo)
  spanDeg: number;
};

export type SectionShape = GridShape | ArcShape;

export type PositionedSeat = { row: string; number: string; x: number; y: number };

const ROW_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function computeSeatPositions(shape: SectionShape): PositionedSeat[] {
  const seats: PositionedSeat[] = [];

  if (shape.type === "grid") {
    for (let r = 0; r < shape.rows; r++) {
      const row = ROW_LETTERS[r] ?? String(r + 1);
      for (let c = 0; c < shape.seatsPerRow; c++) {
        seats.push({
          row,
          number: String(c + 1),
          x: shape.x + c * shape.seatGap,
          y: shape.y + r * shape.rowGap,
        });
      }
    }
    return seats;
  }

  // arco: cada fila es un arco concéntrico, radio creciente hacia afuera
  for (let r = 0; r < shape.rows; r++) {
    const row = ROW_LETTERS[r] ?? String(r + 1);
    const radius = shape.startRadius + r * shape.rowGap;
    const n = shape.seatsPerRow;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const angleDeg = shape.startAngleDeg + t * shape.spanDeg;
      const angleRad = (angleDeg * Math.PI) / 180;
      seats.push({
        row,
        number: String(i + 1),
        x: shape.centerX + radius * Math.cos(angleRad),
        y: shape.centerY + radius * Math.sin(angleRad),
      });
    }
  }
  return seats;
}

export const MAX_ROWS = 26;
export const MAX_SEATS_PER_ROW = 60;

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 640;

/** Lo más juntas que pueden ir dos butacas vecinas (de centro a centro): más cerca ya no se distinguen. */
export const MIN_SEAT_GAP = 8;
/** Radio del punto de cada butaca en los mapas, cuando hay lugar. */
export const SEAT_DOT_RADIUS = 7;

/** Distancia entre butacas vecinas de la forma (la más corta: entre butacas de una fila o entre filas). */
export function shapeSeatSpacing(shape: SectionShape): number {
  const rowGap = shape.rows > 1 ? Math.abs(shape.rowGap) : Infinity;
  if (shape.seatsPerRow < 2) return rowGap;
  if (shape.type === "grid") return Math.min(Math.abs(shape.seatGap), rowGap);
  // En el arco, las butacas más juntas son las de la primera fila (la de radio más chico).
  const stepRad = (Math.abs(shape.spanDeg) / (shape.seatsPerRow - 1)) * (Math.PI / 180);
  return Math.min(2 * Math.abs(shape.startRadius) * Math.sin(stepRad / 2), rowGap);
}

/** Radio del punto para butacas a esa distancia: el de siempre (`max`), o más chico para que no se pisen. */
export function dotRadius(spacing: number, max = SEAT_DOT_RADIUS) {
  return Number.isFinite(spacing) ? Math.max(3, Math.min(max, spacing / 2 - 0.5)) : max;
}

/** Radio del punto de cada butaca de una sección ya cargada (según lo juntas que quedaron sus butacas). */
export function seatDotRadius(seats: { x: number; y: number }[], max = SEAT_DOT_RADIUS) {
  let best = Infinity;
  for (let i = 0; i < seats.length; i++) {
    const a = seats[i]!;
    for (let j = i + 1; j < seats.length; j++) {
      const d = (a.x - seats[j]!.x) ** 2 + (a.y - seats[j]!.y) ** 2;
      // Dos butacas en el mismo lugar (un arco de 360°) no achican a todas las demás.
      if (d >= 1 && d < best) best = d;
    }
  }
  return dotRadius(Math.sqrt(best), max);
}

/** Por qué no se puede guardar la forma, en palabras para el organizador (null si está bien). */
export function seatShapeProblem(shape: SectionShape): string | null {
  if (shapeSeatSpacing(shape) < MIN_SEAT_GAP) {
    return `Las butacas quedan demasiado juntas: deja al menos ${MIN_SEAT_GAP} de espacio entre butacas y entre filas.`;
  }
  const outside = computeSeatPositions(shape).some((s) => s.x < 0 || s.x > CANVAS_WIDTH || s.y < 0 || s.y > CANVAS_HEIGHT);
  if (outside) return "Hay butacas fuera del mapa: achica la sección o muévela hacia adentro.";
  return null;
}

export const SECTION_COLORS = [
  "#F5B700",
  "#FF3D68",
  "#35C48F",
  "#4EA1FF",
  "#B98CFF",
  "#FF7A3D",
];
