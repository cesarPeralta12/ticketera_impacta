/**
 * Colocación automática en el mapa del recinto de lo que todavía no tiene lugar: zonas generales sin forma y
 * puertas sin ubicar. Así el mapa SIEMPRE muestra todas las secciones y puertas, aunque el organizador no las
 * haya dibujado todavía. Puro (sin DOM); mismo lienzo que las butacas (CANVAS_WIDTH × CANVAS_HEIGHT).
 */
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./seat-geometry";
import { zoneBounds, type BoxZone, type ZoneShape } from "./zone-geometry";

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Caja que contiene un conjunto de puntos (butacas), con un margen. */
export function boxOfPoints(points: { x: number; y: number }[], margin = 0): Box | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs) - margin, minY: Math.min(...ys) - margin, maxX: Math.max(...xs) + margin, maxY: Math.max(...ys) + margin };
}

const ZONES_PER_ROW = 4;
const MARGIN = 40;
const GAP = 14;

/**
 * Reparte zonas sin forma en una franja libre bajo todo lo ya dibujado (butacas y zonas con forma). Hasta 4 por
 * fila, de igual ancho; si no hay lugar, se achican. Siempre devuelve una forma dentro del lienzo.
 */
export function autoPlaceZones(ids: string[], occupied: Box[]): Map<string, BoxZone> {
  const placed = new Map<string, BoxZone>();
  if (ids.length === 0) return placed;
  const rows = Math.ceil(ids.length / ZONES_PER_ROW);
  const bottom = CANVAS_HEIGHT - 24;
  const lowest = occupied.length ? Math.max(...occupied.map((b) => b.maxY)) : 0;
  // La franja arranca debajo de lo dibujado, pero nunca tan abajo que no quepan las filas (mínimo 56 de alto).
  const minRowHeight = 56;
  const top = Math.min(Math.max(lowest + 30, 330), bottom - rows * minRowHeight - (rows - 1) * GAP);
  const rowHeight = Math.min(110, (bottom - top - (rows - 1) * GAP) / rows);
  ids.forEach((id, i) => {
    const row = Math.floor(i / ZONES_PER_ROW);
    const inRow = Math.min(ZONES_PER_ROW, ids.length - row * ZONES_PER_ROW);
    const width = (CANVAS_WIDTH - 2 * MARGIN - (inRow - 1) * GAP) / inRow;
    const col = i - row * ZONES_PER_ROW;
    placed.set(id, {
      type: "zone",
      shape: "rect",
      x: Math.round(MARGIN + col * (width + GAP)),
      y: Math.round(top + row * (rowHeight + GAP)),
      width: Math.round(width),
      height: Math.round(rowHeight),
    });
  });
  return placed;
}

export type GatePoint = { id: string; name: string; x: number; y: number };

/** Puertas sin ubicar: se reparten a lo largo del borde de abajo, para que igual se vean (y se puedan mover). */
export function autoPlaceGates(unplaced: { id: string; name: string }[]): GatePoint[] {
  const n = unplaced.length;
  return unplaced.map((g, i) => ({ ...g, x: Math.round(((i + 1) * CANVAS_WIDTH) / (n + 1)), y: CANVAS_HEIGHT - 18 }));
}

/** Ancho aproximado de la etiqueta de una puerta (para dibujar el fondo de la píldora). */
export const gateLabelWidth = (name: string) => Math.round(36 + name.length * 6.8);

/** Unifica zonas con forma (la guardada) y sin forma (colocada automáticamente), en el orden dado. */
export function resolveZones<T extends { id: string; layout: ZoneShape | null }>(
  zones: T[],
  seatBoxes: Box[],
): { zone: T; shape: ZoneShape; auto: boolean }[] {
  const drawn = zones.flatMap((z) => (z.layout ? [zoneBounds(z.layout)] : []));
  const auto = autoPlaceZones(
    zones.filter((z) => !z.layout).map((z) => z.id),
    [...seatBoxes, ...drawn],
  );
  return zones.map((z) => (z.layout ? { zone: z, shape: z.layout, auto: false } : { zone: z, shape: auto.get(z.id)!, auto: true }));
}
