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

export const SECTION_COLORS = [
  "#F5B700",
  "#FF3D68",
  "#35C48F",
  "#4EA1FF",
  "#B98CFF",
  "#FF7A3D",
];
