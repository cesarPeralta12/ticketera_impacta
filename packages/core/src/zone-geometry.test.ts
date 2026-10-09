import { describe, expect, it } from "vitest";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./seat-geometry";
import {
  defaultZone,
  isZoneLayout,
  parseZoneLayout,
  zoneBounds,
  zoneLabelPoint,
  zonePath,
  zonesOverlap,
  type ZoneShape,
} from "./zone-geometry";

const rect: ZoneShape = { type: "zone", shape: "rect", x: 100, y: 200, width: 300, height: 120 };

describe("formas de zona", () => {
  it("el rectángulo es un camino cerrado con sus cuatro esquinas", () => {
    expect(zonePath(rect)).toBe("M100 200H400V320H100Z");
    expect(zoneBounds(rect)).toEqual({ minX: 100, minY: 200, maxX: 400, maxY: 320 });
    expect(zoneLabelPoint(rect)).toEqual({ x: 250, y: 260 });
  });

  it("el óvalo se dibuja con dos arcos y el trapecio es más angosto arriba", () => {
    const ellipse: ZoneShape = { type: "zone", shape: "ellipse", x: 100, y: 200, width: 300, height: 120 };
    expect(zonePath(ellipse)).toMatch(/^M100 260a150 60 0 1 0 300 0a150 60 0 1 0 -300 0Z$/);
    const trap: ZoneShape = { type: "zone", shape: "trapezoid", x: 100, y: 200, width: 300, height: 120, taper: 0.2 };
    expect(zonePath(trap)).toBe("M130 200H370L400 320H100Z");
  });

  it("el arco es un tramo de corona y su caja incluye los extremos cardinales", () => {
    const arc: ZoneShape = { type: "zone", shape: "arc", centerX: 500, centerY: 100, innerRadius: 200, outerRadius: 300, startAngleDeg: 45, spanDeg: 90 };
    const path = zonePath(arc);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path.match(/A/g)).toHaveLength(2);
    const b = zoneBounds(arc);
    expect(b.maxY).toBeCloseTo(100 + 300, 5); // pasa por los 90° (hacia abajo) con el radio exterior
    expect(b.minY).toBeCloseTo(100 + 200 * Math.sin((45 * Math.PI) / 180), 5);
    const label = zoneLabelPoint(arc);
    expect(label.x).toBeCloseTo(500, 5);
    expect(label.y).toBeCloseTo(100 + 250, 5);
  });

  it("detecta cuándo dos zonas se pisan", () => {
    const apart: ZoneShape = { type: "zone", shape: "rect", x: 500, y: 200, width: 100, height: 100 };
    const touching: ZoneShape = { type: "zone", shape: "ellipse", x: 350, y: 250, width: 200, height: 100 };
    expect(zonesOverlap(rect, apart)).toBe(false);
    expect(zonesOverlap(rect, touching)).toBe(true);
  });

  it("isZoneLayout distingue la zona de la receta de butacas", () => {
    expect(isZoneLayout(rect)).toBe(true);
    expect(isZoneLayout({ type: "grid", rows: 2 })).toBe(false);
    expect(isZoneLayout(null)).toBe(false);
  });
});

describe("parseZoneLayout", () => {
  it("acepta las formas por defecto y las redondea", () => {
    for (const shape of ["rect", "ellipse", "trapezoid", "arc"] as const) {
      expect(parseZoneLayout(defaultZone(shape))).toMatchObject({ ok: true });
    }
    const r = parseZoneLayout({ ...rect, x: 100.6, width: 299.4 });
    expect(r).toMatchObject({ ok: true, zone: { x: 101, width: 299 } });
  });

  it("limita el afilado del trapecio", () => {
    const r = parseZoneLayout({ type: "zone", shape: "trapezoid", x: 100, y: 100, width: 200, height: 100, taper: 5 });
    expect(r).toMatchObject({ ok: true, zone: { taper: 0.8 } });
  });

  it("rechaza lo que se sale del mapa, es muy pequeño o está incompleto", () => {
    expect(parseZoneLayout({ ...rect, x: CANVAS_WIDTH - 100 })).toMatchObject({ ok: false, error: expect.stringContaining("se sale del mapa") });
    expect(parseZoneLayout({ ...rect, y: CANVAS_HEIGHT - 10 })).toMatchObject({ ok: false });
    expect(parseZoneLayout({ ...rect, x: -5 })).toMatchObject({ ok: false });
    expect(parseZoneLayout({ ...rect, width: 10 })).toMatchObject({ ok: false, error: expect.stringContaining("al menos") });
    expect(parseZoneLayout({ type: "zone", shape: "rect", x: 1 })).toMatchObject({ ok: false });
    expect(parseZoneLayout({ type: "zone", shape: "triangulo" })).toMatchObject({ ok: false });
    expect(parseZoneLayout({ type: "grid" })).toMatchObject({ ok: false });
    expect(parseZoneLayout("hola")).toMatchObject({ ok: false });
    expect(parseZoneLayout({ ...rect, width: Number.NaN })).toMatchObject({ ok: false });
  });

  it("valida el arco: grosor y apertura", () => {
    const arc = { type: "zone", shape: "arc", centerX: 500, centerY: 60, innerRadius: 200, outerRadius: 300, startAngleDeg: 30, spanDeg: 120 };
    expect(parseZoneLayout(arc)).toMatchObject({ ok: true });
    expect(parseZoneLayout({ ...arc, outerRadius: 210 })).toMatchObject({ ok: false, error: expect.stringContaining("grosor") });
    expect(parseZoneLayout({ ...arc, spanDeg: 5 })).toMatchObject({ ok: false, error: expect.stringContaining("apertura") });
    expect(parseZoneLayout({ ...arc, outerRadius: 900 })).toMatchObject({ ok: false, error: expect.stringContaining("se sale del mapa") });
  });
});
