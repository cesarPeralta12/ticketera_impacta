/**
 * Zonas de entrada general (sin butacas) dibujadas en el mapa del recinto: una forma sobre el mismo lienzo
 * que las butacas (CANVAS_WIDTH × CANVAS_HEIGHT). Puro (sin DOM): lo usan el editor del panel, el mapa de la
 * función, el mapa del comprador y la semilla.
 *
 * Formas: rectángulo, óvalo, trapecio (más angosto arriba, hacia el escenario) y arco (cabeceras curvas).
 * Se guardan en `Section.layout` con `type: "zone"`.
 */
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./seat-geometry";

export type BoxZone = {
  type: "zone";
  shape: "rect" | "ellipse" | "trapezoid";
  x: number; // esquina superior-izquierda
  y: number;
  width: number;
  height: number;
  /** Solo trapecio: cuánto más angosto es el borde de arriba (0 = rectángulo, 0.8 = casi un triángulo). */
  taper?: number;
};

export type ArcZone = {
  type: "zone";
  shape: "arc";
  centerX: number;
  centerY: number;
  innerRadius: number;
  outerRadius: number;
  startAngleDeg: number; // 0° = derecha, 90° = abajo (el eje Y crece hacia abajo)
  spanDeg: number;
};

export type ZoneShape = BoxZone | ArcZone;
export type ZoneShapeName = ZoneShape["shape"];

export const ZONE_SHAPE_LABEL: Record<ZoneShapeName, string> = {
  rect: "Rectángulo",
  ellipse: "Óvalo",
  trapezoid: "Trapecio",
  arc: "Arco",
};

export const MIN_ZONE_SIZE = 40;

const rad = (deg: number) => (deg * Math.PI) / 180;
const round = (n: number) => Math.round(n * 100) / 100;

/** ¿Este `layout` de una sección es una zona (y no la receta de butacas)? */
export function isZoneLayout(layout: unknown): layout is ZoneShape {
  return typeof layout === "object" && layout !== null && (layout as { type?: unknown }).type === "zone";
}

/** Contorno de la zona como camino SVG (`d`). Sirve igual para dibujar, recortar y comprobar choques. */
export function zonePath(zone: ZoneShape): string {
  if (zone.shape !== "arc") return boxPath(zone);
  return arcPath(zone);
}

function boxPath(zone: BoxZone): string {
  if (zone.shape === "rect") {
    const { x, y, width: w, height: h } = zone;
    return `M${round(x)} ${round(y)}H${round(x + w)}V${round(y + h)}H${round(x)}Z`;
  }
  if (zone.shape === "ellipse") {
    const rx = zone.width / 2;
    const ry = zone.height / 2;
    const cx = zone.x + rx;
    const cy = zone.y + ry;
    return `M${round(cx - rx)} ${round(cy)}a${round(rx)} ${round(ry)} 0 1 0 ${round(2 * rx)} 0a${round(rx)} ${round(ry)} 0 1 0 ${round(-2 * rx)} 0Z`;
  }
  {
    const inset = (zone.width * Math.min(Math.max(zone.taper ?? 0.25, 0), 0.8)) / 2;
    const { x, y, width: w, height: h } = zone;
    return `M${round(x + inset)} ${round(y)}H${round(x + w - inset)}L${round(x + w)} ${round(y + h)}H${round(x)}Z`;
  }
}

/** Arco: un tramo de corona circular entre dos radios. */
function arcPath(zone: ArcZone): string {
  const span = Math.min(Math.max(zone.spanDeg, 1), 359.9);
  const a0 = rad(zone.startAngleDeg);
  const a1 = rad(zone.startAngleDeg + span);
  const point = (r: number, a: number) => `${round(zone.centerX + r * Math.cos(a))} ${round(zone.centerY + r * Math.sin(a))}`;
  const large = span > 180 ? 1 : 0;
  return (
    `M${point(zone.outerRadius, a0)}` +
    `A${round(zone.outerRadius)} ${round(zone.outerRadius)} 0 ${large} 1 ${point(zone.outerRadius, a1)}` +
    `L${point(zone.innerRadius, a1)}` +
    `A${round(zone.innerRadius)} ${round(zone.innerRadius)} 0 ${large} 0 ${point(zone.innerRadius, a0)}Z`
  );
}

/** Rectángulo que contiene la zona. */
export function zoneBounds(zone: ZoneShape): { minX: number; minY: number; maxX: number; maxY: number } {
  if (zone.shape !== "arc") return { minX: zone.x, minY: zone.y, maxX: zone.x + zone.width, maxY: zone.y + zone.height };
  const span = Math.min(Math.max(zone.spanDeg, 1), 359.9);
  const xs: number[] = [];
  const ys: number[] = [];
  const angles = [zone.startAngleDeg, zone.startAngleDeg + span];
  // Los ángulos cardinales dentro del tramo también son extremos.
  for (let a = Math.ceil(zone.startAngleDeg / 90) * 90; a <= zone.startAngleDeg + span; a += 90) angles.push(a);
  for (const a of angles) {
    for (const r of [zone.innerRadius, zone.outerRadius]) {
      xs.push(zone.centerX + r * Math.cos(rad(a)));
      ys.push(zone.centerY + r * Math.sin(rad(a)));
    }
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Dónde poner el nombre de la zona: su centro (en un arco, a mitad de recorrido y de grosor). */
export function zoneLabelPoint(zone: ZoneShape): { x: number; y: number } {
  if (zone.shape !== "arc") return { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 + (zone.shape === "trapezoid" ? zone.height * 0.05 : 0) };
  const mid = rad(zone.startAngleDeg + Math.min(Math.max(zone.spanDeg, 1), 359.9) / 2);
  const r = (zone.innerRadius + zone.outerRadius) / 2;
  return { x: zone.centerX + r * Math.cos(mid), y: zone.centerY + r * Math.sin(mid) };
}

/** Tamaño aproximado (ancho, alto) que ocupa la zona, para decidir si el texto cabe dentro. */
export function zoneSize(zone: ZoneShape): { width: number; height: number } {
  const b = zoneBounds(zone);
  return { width: b.maxX - b.minX, height: b.maxY - b.minY };
}

/** ¿Las cajas de dos zonas se pisan? (aproximación: basta para avisar al diseñar). */
export function zonesOverlap(a: ZoneShape, b: ZoneShape): boolean {
  const p = zoneBounds(a);
  const q = zoneBounds(b);
  return p.minX < q.maxX && q.minX < p.maxX && p.minY < q.maxY && q.minY < p.maxY;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Valida lo que llega del editor (o de la base) y lo devuelve normalizado, o un motivo. Todo tiene que caber
 * en el lienzo y tener un tamaño mínimo: nada de formas invisibles ni fuera del mapa.
 */
export function parseZoneLayout(input: unknown): { ok: true; zone: ZoneShape } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isZoneLayout(input)) return fail("La forma de la zona no es válida.");
  const z = input as Record<string, unknown>;
  const inCanvas = (zone: ZoneShape) => {
    const b = zoneBounds(zone);
    return b.minX >= 0 && b.minY >= 0 && b.maxX <= CANVAS_WIDTH && b.maxY <= CANVAS_HEIGHT;
  };

  if (z.shape === "rect" || z.shape === "ellipse" || z.shape === "trapezoid") {
    if (![z.x, z.y, z.width, z.height].every(finite)) return fail("Faltan medidas de la zona.");
    const zone: BoxZone = {
      type: "zone",
      shape: z.shape,
      x: Math.round(z.x as number),
      y: Math.round(z.y as number),
      width: Math.round(z.width as number),
      height: Math.round(z.height as number),
      ...(z.shape === "trapezoid" ? { taper: Math.min(Math.max(finite(z.taper) ? z.taper : 0.25, 0), 0.8) } : {}),
    };
    if (zone.width < MIN_ZONE_SIZE || zone.height < MIN_ZONE_SIZE) return fail(`La zona debe medir al menos ${MIN_ZONE_SIZE} × ${MIN_ZONE_SIZE}.`);
    if (!inCanvas(zone)) return fail("La zona se sale del mapa: muévela o hazla más pequeña.");
    return { ok: true, zone };
  }
  if (z.shape === "arc") {
    if (![z.centerX, z.centerY, z.innerRadius, z.outerRadius, z.startAngleDeg, z.spanDeg].every(finite)) return fail("Faltan medidas de la zona.");
    const zone: ArcZone = {
      type: "zone",
      shape: "arc",
      centerX: Math.round(z.centerX as number),
      centerY: Math.round(z.centerY as number),
      innerRadius: Math.round(z.innerRadius as number),
      outerRadius: Math.round(z.outerRadius as number),
      startAngleDeg: Math.round(z.startAngleDeg as number),
      spanDeg: Math.round(z.spanDeg as number),
    };
    if (zone.innerRadius < 0 || zone.outerRadius - zone.innerRadius < 20) return fail("El arco necesita al menos 20 de grosor.");
    if (zone.spanDeg < 10 || zone.spanDeg > 360) return fail("La apertura del arco debe estar entre 10° y 360°.");
    if (!inCanvas(zone)) return fail("La zona se sale del mapa: muévela o hazla más pequeña.");
    return { ok: true, zone };
  }
  return fail("Elige la forma de la zona.");
}

/** Zona por defecto de cada forma, en una posición cómoda del lienzo. */
export function defaultZone(shape: ZoneShapeName, at: { x: number; y: number } = { x: 300, y: 380 }): ZoneShape {
  if (shape === "arc") {
    return { type: "zone", shape: "arc", centerX: CANVAS_WIDTH / 2, centerY: 60, innerRadius: 200, outerRadius: 300, startAngleDeg: 30, spanDeg: 120 };
  }
  const base = { type: "zone" as const, x: at.x, y: at.y, width: 400, height: 160 };
  return shape === "trapezoid" ? { ...base, shape, taper: 0.3 } : { ...base, shape };
}
