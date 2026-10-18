/**
 * Plano de un boliche sobre el mismo lienzo que butacas y zonas (CANVAS_WIDTH × CANVAS_HEIGHT):
 *  - elementos que no se venden (escenario, barra, DJ, entrada, baños, un texto), guardados en `Venue.mapItems`;
 *  - lounges o mesas como círculos puestos uno por uno donde están en el local: una sección numerada cuyo
 *    `layout` es `{ type: "tables" }` y cada butaca es una mesa (el comprador elige la suya en el mapa).
 * Puro (sin DOM): lo usan el editor del panel, los mapas del panel y el del comprador.
 */
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./seat-geometry";

export const MAP_ITEM_KINDS = ["STAGE", "BAR", "DJ", "ENTRANCE", "BATHROOM", "LABEL"] as const;
export type MapItemKind = (typeof MAP_ITEM_KINDS)[number];

export const MAP_ITEM_LABEL: Record<MapItemKind, string> = {
  STAGE: "Escenario",
  BAR: "Barra",
  DJ: "DJ",
  ENTRANCE: "Entrada",
  BATHROOM: "Baños",
  LABEL: "Texto",
};

export const MAP_ITEM_COLOR: Record<MapItemKind, string> = {
  STAGE: "#F5B700",
  BAR: "#4EA1FF",
  DJ: "#C04BFF",
  ENTRANCE: "#35C48F",
  BATHROOM: "#9A96A6",
  LABEL: "#9A96A6",
};

/** Tamaño con el que aparece cada elemento nuevo (ancho × alto en el lienzo). */
const DEFAULT_SIZE: Record<MapItemKind, [number, number]> = {
  STAGE: [320, 60],
  BAR: [220, 44],
  DJ: [90, 60],
  ENTRANCE: [110, 36],
  BATHROOM: [90, 50],
  LABEL: [140, 32],
};

export type MapItem = { id: string; kind: MapItemKind; label: string; x: number; y: number; width: number; height: number };

export const MAX_MAP_ITEMS = 40;
export const MIN_ITEM_SIZE = 20;
const round = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Elemento nuevo centrado en un punto del lienzo. */
export function defaultMapItem(kind: MapItemKind, at: { x: number; y: number }, id: string): MapItem {
  const [width, height] = DEFAULT_SIZE[kind];
  return {
    id,
    kind,
    label: MAP_ITEM_LABEL[kind],
    width,
    height,
    x: round(clamp(at.x - width / 2, 0, CANVAS_WIDTH - width)),
    y: round(clamp(at.y - height / 2, 0, CANVAS_HEIGHT - height)),
  };
}

/** Valida y ordena los elementos del plano que manda el editor; null si algo no es válido. */
export function parseMapItems(input: unknown): MapItem[] | null {
  if (!Array.isArray(input) || input.length > MAX_MAP_ITEMS) return null;
  const items: MapItem[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (!MAP_ITEM_KINDS.includes(r.kind as MapItemKind)) return null;
    const [x, y, width, height] = [r.x, r.y, r.width, r.height].map(Number) as [number, number, number, number];
    if (![x, y, width, height].every(Number.isFinite)) return null;
    const w = clamp(width, MIN_ITEM_SIZE, CANVAS_WIDTH);
    const h = clamp(height, MIN_ITEM_SIZE, CANVAS_HEIGHT);
    items.push({
      id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : `item-${items.length + 1}`,
      kind: r.kind as MapItemKind,
      label: String(r.label ?? "").trim().slice(0, 30) || MAP_ITEM_LABEL[r.kind as MapItemKind],
      x: round(clamp(x, 0, CANVAS_WIDTH - w)),
      y: round(clamp(y, 0, CANVAS_HEIGHT - h)),
      width: round(w),
      height: round(h),
    });
  }
  return items;
}

/** ¿El plano ya dibuja su propio escenario? (si no, los mapas muestran el de siempre arriba al centro). */
export function hasStage(items: MapItem[] | null | undefined): boolean {
  return Boolean(items?.some((i) => i.kind === "STAGE"));
}

/** Lo guardado en `Venue.mapItems` (JSON) como lista de elementos; vacía si no hay o no es válido. */
export function mapItemsOf(value: unknown): MapItem[] {
  return parseMapItems(value) ?? [];
}

// ── Lounges / mesas en círculo ──

/** `shape`: "round" = lounge o mesa (círculo); "rect" = reservado (rectángulo). Los viejos no lo traen: círculo. */
export type TablesLayout = { type: "tables"; radius: number; prefix: string; shape?: "round" | "rect" };

export const TABLE_RADIUS = 18;
export const MAX_TABLES = 200;

export function isTablesLayout(layout: unknown): layout is TablesLayout {
  return typeof layout === "object" && layout !== null && (layout as { type?: unknown }).type === "tables";
}

/** Nombre de cada mesa del grupo: "Lounge 3". */
export function tableName(prefix: string, number: number | string): string {
  return `${prefix} ${number}`;
}

export type PlacedTable = { id?: string; number: number; x: number; y: number };

/**
 * Valida las mesas que manda el editor: dentro del lienzo, sin números repetidos ni círculos encimados.
 * Devuelve el motivo si algo no está bien.
 */
export function parseTables(input: unknown, radius = TABLE_RADIUS): { ok: true; tables: PlacedTable[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "Pon al menos un lounge en el plano." };
  if (input.length > MAX_TABLES) return { ok: false, error: `Máximo ${MAX_TABLES} lounges por grupo.` };
  const tables: PlacedTable[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "Lounge inválido." };
    const r = raw as Record<string, unknown>;
    const [number, x, y] = [r.number, r.x, r.y].map(Number) as [number, number, number];
    if (!Number.isInteger(number) || number < 1 || number > 999 || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: "Lounge inválido." };
    }
    tables.push({
      ...(typeof r.id === "string" && r.id ? { id: r.id } : {}),
      number,
      x: round(clamp(x, radius, CANVAS_WIDTH - radius)),
      y: round(clamp(y, radius, CANVAS_HEIGHT - radius)),
    });
  }
  if (new Set(tables.map((t) => t.number)).size !== tables.length) return { ok: false, error: "Hay dos lounges con el mismo número." };
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const a = tables[i]!;
      const b = tables[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) < radius * 2 - 2) {
        return { ok: false, error: `Los lounges ${a.number} y ${b.number} están encimados: sepáralos un poco.` };
      }
    }
  }
  return { ok: true, tables: tables.toSorted((a, b) => a.number - b.number) };
}

/** Número para el próximo lounge del grupo. */
export function nextTableNumber(tables: { number: number }[]): number {
  return tables.reduce((max, t) => Math.max(max, t.number), 0) + 1;
}

/** Un reservado se dibuja como rectángulo: ancho y alto alrededor de su centro. */
export function reservadoSize(radius: number) {
  return { width: radius * 3, height: radius * 2 };
}
