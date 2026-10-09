import { describe, expect, it } from "vitest";
import { autoPlaceGates, autoPlaceZones, boxOfPoints, gateLabelWidth, resolveZones } from "./map-layout";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./seat-geometry";
import { zoneBounds, zonesOverlap, type ZoneShape } from "./zone-geometry";

const inCanvas = (z: ZoneShape) => {
  const b = zoneBounds(z);
  return b.minX >= 0 && b.minY >= 0 && b.maxX <= CANVAS_WIDTH && b.maxY <= CANVAS_HEIGHT;
};

describe("colocación automática de zonas", () => {
  it("una sola zona va en la franja de abajo, debajo de las butacas", () => {
    const seats = boxOfPoints([{ x: 250, y: 80 }, { x: 650, y: 330 }])!;
    const placed = autoPlaceZones(["z1"], [seats]);
    const z = placed.get("z1")!;
    expect(z.shape).toBe("rect");
    expect(z.y).toBeGreaterThanOrEqual(seats.maxY);
    expect(inCanvas(z)).toBe(true);
    expect(zonesOverlap(z, { type: "zone", shape: "rect", x: 250, y: 80, width: 400, height: 250 })).toBe(false);
  });

  it("reparte varias zonas sin pisarse, hasta 4 por fila, siempre dentro del lienzo", () => {
    for (const n of [2, 3, 4, 5, 8]) {
      const ids = Array.from({ length: n }, (_, i) => `z${i}`);
      const placed = [...autoPlaceZones(ids, []).values()];
      expect(placed).toHaveLength(n);
      placed.forEach((z) => expect(inCanvas(z)).toBe(true));
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) expect(zonesOverlap(placed[i]!, placed[j]!)).toBe(false);
      }
    }
  });

  it("si lo dibujado llega hasta abajo, igual cabe en el lienzo (se achica)", () => {
    const placed = autoPlaceZones(["a", "b", "c", "d", "e"], [{ minX: 0, minY: 0, maxX: 1000, maxY: 600 }]);
    [...placed.values()].forEach((z) => {
      expect(inCanvas(z)).toBe(true);
      expect(z.height).toBeGreaterThanOrEqual(56);
    });
  });

  it("sin zonas no devuelve nada", () => {
    expect(autoPlaceZones([], []).size).toBe(0);
    expect(boxOfPoints([])).toBeNull();
  });

  it("resolveZones respeta la forma guardada y coloca solo las que no tienen", () => {
    const saved: ZoneShape = { type: "zone", shape: "ellipse", x: 100, y: 100, width: 200, height: 100 };
    const out = resolveZones(
      [
        { id: "con", layout: saved },
        { id: "sin", layout: null },
      ],
      [],
    );
    expect(out[0]).toMatchObject({ shape: saved, auto: false });
    expect(out[1]).toMatchObject({ auto: true });
    expect(zonesOverlap(out[0]!.shape, out[1]!.shape)).toBe(false);
  });
});

describe("puertas sin ubicar", () => {
  it("se reparten a lo largo del borde de abajo", () => {
    const gates = autoPlaceGates([
      { id: "a", name: "Norte" },
      { id: "b", name: "Sur" },
      { id: "c", name: "Este" },
    ]);
    expect(gates.map((g) => g.x)).toEqual([250, 500, 750]);
    expect(new Set(gates.map((g) => g.y)).size).toBe(1);
    expect(gates.every((g) => g.y <= CANVAS_HEIGHT && g.x >= 0 && g.x <= CANVAS_WIDTH)).toBe(true);
    expect(autoPlaceGates([])).toEqual([]);
  });

  it("el ancho de la etiqueta crece con el nombre", () => {
    expect(gateLabelWidth("Acceso norte")).toBeGreaterThan(gateLabelWidth("Norte"));
  });
});
