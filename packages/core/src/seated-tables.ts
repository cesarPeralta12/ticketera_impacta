/**
 * Mesas con sillas alrededor (redondas o rectangulares): cada silla es una butaca de una sección numerada cuyo `layout`
 * es `{ type: "seated" }`. La mesa se vende de una de tres formas:
 *  - WHOLE: la mesa completa (todas sus sillas en la misma compra);
 *  - SEAT: por silla, como una butaca;
 *  - RANGE: de N a M sillas de una misma mesa por compra.
 * Puro (sin DOM): lo usan el editor del panel, los mapas y la validación de la compra.
 */
import { CANVAS_HEIGHT, CANVAS_WIDTH, seatDotRadius } from "./seat-geometry";

export const TABLE_SALE_MODES = ["WHOLE", "SEAT", "RANGE"] as const;
export type TableSaleMode = (typeof TABLE_SALE_MODES)[number];

export const TABLE_SALE_MODE_LABEL: Record<TableSaleMode, string> = {
  WHOLE: "Mesa completa",
  SEAT: "Por silla",
  RANGE: "De N a M sillas",
};

export type TableShape = "round" | "rect";

export type SeatedTable = { number: number; x: number; y: number };

export type SeatedTablesLayout = {
  type: "seated";
  /** Nombre de cada mesa: "Mesa 3". */
  prefix: string;
  shape: TableShape;
  /** Sillas por mesa. */
  chairs: number;
  mode: TableSaleMode;
  /** En RANGE: mínimo y máximo de sillas de una mesa por compra. */
  min: number;
  max: number;
  /** Radio (redonda) o medio ancho (rectangular) de la mesa en el lienzo. */
  size: number;
  tables: SeatedTable[];
};

export const MIN_CHAIRS = 2;
/** Una compra lleva hasta 10 entradas: una mesa completa no puede tener más sillas. */
export const MAX_CHAIRS = 10;
export const MAX_SEATED_TABLES = 120;
/** Tamaño de la mesa (radio de la redonda o medio ancho de la rectangular) que se puede elegir en el editor. */
export const MIN_TABLE_SIZE = 8;
export const MAX_TABLE_SIZE = 60;
/** Tamaño con el que arranca el editor (el que tenían siempre las mesas). */
export const DEFAULT_TABLE_SIZE: Record<TableShape, number> = { round: 22, rect: 30 };
const CHAIR_GAP = 13;

/** Del borde de la mesa a sus sillas: lo de siempre, y menos en una mesa chica para que las sillas no queden sueltas. */
export function chairGap(size: number) {
  return size >= 14 ? CHAIR_GAP : Math.max(7, size - 1);
}

/** Radio con que se dibuja cada silla: 6, o menos si las sillas de la mesa quedan muy juntas (mesa chica). */
export function chairRadius(shape: TableShape, chairs: number, size: number) {
  return seatDotRadius(chairPositions(shape, chairs, { x: 0, y: 0 }, size), 6);
}

/** Tamaño de letra del número de la mesa (más chico en mesas chicas, para que entre). */
export function tableNumberFontSize(size: number) {
  return Math.min(11, Math.max(7, size * 0.75));
}

export function isSeatedTablesLayout(layout: unknown): layout is SeatedTablesLayout {
  return typeof layout === "object" && layout !== null && (layout as { type?: unknown }).type === "seated";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Dónde va cada silla alrededor de su mesa (en orden: la silla 1 arriba y después en el sentido del reloj). */
export function chairPositions(shape: TableShape, chairs: number, center: { x: number; y: number }, size: number): { x: number; y: number }[] {
  const gap = chairGap(size);
  if (shape === "round") {
    const distance = size + gap;
    return Array.from({ length: chairs }, (_, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / chairs;
      return { x: round1(center.x + distance * Math.cos(angle)), y: round1(center.y + distance * Math.sin(angle)) };
    });
  }
  // Rectangular: mitad arriba y mitad abajo (la de arriba lleva una más si es impar), repartidas a lo ancho.
  const top = Math.ceil(chairs / 2);
  const bottom = chairs - top;
  const height = tableHeight(size);
  const row = (count: number, y: number, reverse: boolean) =>
    Array.from({ length: count }, (_, i) => {
      const t = (i + 1) / (count + 1);
      const x = center.x - size + 2 * size * (reverse ? 1 - t : t);
      return { x: round1(x), y: round1(y) };
    });
  return [...row(top, center.y - height / 2 - gap, false), ...row(bottom, center.y + height / 2 + gap, true)];
}

/** Alto de una mesa rectangular (su ancho es 2 × size). */
export function tableHeight(size: number) {
  return Math.max(16, size * 0.7);
}

/** Las mesas en una grilla: `count` mesas, `perRow` por fila, desde (x, y) con la separación dada. */
export function seatedTablesGrid(opts: { count: number; perRow: number; x: number; y: number; gapX: number; gapY: number; first?: number }): SeatedTable[] {
  return Array.from({ length: opts.count }, (_, i) => ({
    number: (opts.first ?? 1) + i,
    x: round1(opts.x + (i % opts.perRow) * opts.gapX),
    y: round1(opts.y + Math.floor(i / opts.perRow) * opts.gapY),
  }));
}

/** Las butacas (sillas) de todas las mesas: fila = número de mesa, número = silla. */
export function seatedTableSeats(layout: SeatedTablesLayout): { row: string; number: string; label: string; x: number; y: number }[] {
  return layout.tables.flatMap((table) =>
    chairPositions(layout.shape, layout.chairs, table, layout.size).map((p, i) => ({
      row: String(table.number),
      number: String(i + 1),
      label: `${layout.prefix} ${table.number} · silla ${i + 1}`,
      x: p.x,
      y: p.y,
    })),
  );
}

/** Valida lo que arma el editor; devuelve el motivo si algo no está bien. */
export function parseSeatedTablesLayout(input: unknown): { ok: true; layout: SeatedTablesLayout } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "Las mesas no son válidas." };
  const r = input as Record<string, unknown>;
  const shape = r.shape === "rect" ? "rect" : r.shape === "round" ? "round" : null;
  const mode = TABLE_SALE_MODES.find((m) => m === r.mode);
  const chairs = Number(r.chairs);
  const size = Number(r.size);
  const prefix = String(r.prefix ?? "").trim().slice(0, 20);
  if (!shape) return { ok: false, error: "Elige la forma de las mesas." };
  if (!mode) return { ok: false, error: "Elige cómo se venden las mesas." };
  if (!Number.isInteger(chairs) || chairs < MIN_CHAIRS || chairs > MAX_CHAIRS) return { ok: false, error: `Cada mesa lleva de ${MIN_CHAIRS} a ${MAX_CHAIRS} sillas.` };
  if (!Number.isFinite(size) || size < MIN_TABLE_SIZE || size > MAX_TABLE_SIZE) {
    return { ok: false, error: `El tamaño de la mesa va de ${MIN_TABLE_SIZE} a ${MAX_TABLE_SIZE}.` };
  }
  if (prefix.length < 1) return { ok: false, error: "Ponle un nombre a las mesas (ej. Mesa)." };
  let min = Number(r.min ?? 1);
  let max = Number(r.max ?? chairs);
  if (mode === "RANGE") {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > chairs || min > max) {
      return { ok: false, error: `En "de N a M", N y M van de 1 a ${chairs} sillas (N ≤ M).` };
    }
  } else {
    [min, max] = mode === "WHOLE" ? [chairs, chairs] : [1, chairs];
  }
  if (!Array.isArray(r.tables) || r.tables.length === 0) return { ok: false, error: "Pon al menos una mesa." };
  if (r.tables.length > MAX_SEATED_TABLES) return { ok: false, error: `Máximo ${MAX_SEATED_TABLES} mesas por sección.` };
  const tables: SeatedTable[] = [];
  for (const raw of r.tables as unknown[]) {
    const t = raw as Record<string, unknown>;
    const [number, x, y] = [t.number, t.x, t.y].map(Number) as [number, number, number];
    if (!Number.isInteger(number) || number < 1 || number > 999 || !Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Mesa inválida." };
    tables.push({ number, x: round1(x), y: round1(y) });
  }
  if (new Set(tables.map((t) => t.number)).size !== tables.length) return { ok: false, error: "Hay dos mesas con el mismo número." };
  const layout: SeatedTablesLayout = { type: "seated", prefix, shape, chairs, mode, min, max, size: round1(size), tables };
  const outside = seatedTableSeats(layout).some((s) => s.x < 4 || s.y < 4 || s.x > CANVAS_WIDTH - 4 || s.y > CANVAS_HEIGHT - 4);
  if (outside) return { ok: false, error: "Algunas mesas quedan fuera del mapa: corre el inicio o achica la separación." };
  const reach = shape === "round" ? 2 * (size + chairGap(size) + 6) : 0;
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const a = tables[i]!;
      const b = tables[j]!;
      const overlap =
        shape === "round"
          ? Math.hypot(a.x - b.x, a.y - b.y) < reach
          : Math.abs(a.x - b.x) < 2 * size + 8 && Math.abs(a.y - b.y) < tableHeight(size) + 2 * chairGap(size) + 14;
      if (overlap) return { ok: false, error: `Las mesas ${a.number} y ${b.number} quedan encimadas: sepáralas más.` };
    }
  }
  return { ok: true, layout };
}

/**
 * Revisa las sillas elegidas de una sección de mesas según cómo se venden. `chosen`: la mesa (fila) de cada silla
 * elegida; `chairsLeft`: sillas libres que le quedan a cada mesa (para la mesa completa). Devuelve el problema o null.
 */
export function checkTableSelection(layout: SeatedTablesLayout, chosen: string[], chairsLeft?: Map<string, number>): string | null {
  const byTable = new Map<string, number>();
  for (const table of chosen) byTable.set(table, (byTable.get(table) ?? 0) + 1);
  for (const [table, count] of byTable) {
    const name = `${layout.prefix} ${table}`;
    if (layout.mode === "WHOLE" && count !== layout.chairs) {
      return chairsLeft && (chairsLeft.get(table) ?? 0) < layout.chairs
        ? `${name} ya tiene sillas vendidas: elige otra mesa.`
        : `${name} se vende completa: son ${layout.chairs} sillas.`;
    }
    if (layout.mode === "RANGE" && (count < layout.min || count > layout.max)) {
      return layout.min === layout.max
        ? `En ${name} se compran ${layout.min} sillas.`
        : `En ${name} se compran de ${layout.min} a ${layout.max} sillas (elegiste ${count}).`;
    }
  }
  return null;
}
