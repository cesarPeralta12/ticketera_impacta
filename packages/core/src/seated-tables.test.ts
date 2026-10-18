import { describe, expect, it } from "vitest";
import { chairPositions, checkTableSelection, parseSeatedTablesLayout, seatedTableSeats, seatedTablesGrid, type SeatedTablesLayout } from "./seated-tables";

const base = { type: "seated", prefix: "Mesa", shape: "round", chairs: 6, mode: "WHOLE", size: 22 } as const;

describe("mesas con sillas", () => {
  it("ubica las sillas alrededor de la mesa", () => {
    const round = chairPositions("round", 4, { x: 100, y: 100 }, 20);
    expect(round[0]).toEqual({ x: 100, y: 67 }); // la silla 1 arriba
    expect(round[1]!.x).toBeGreaterThan(100); // después a la derecha
    const rect = chairPositions("rect", 5, { x: 100, y: 100 }, 30);
    expect(rect.filter((c) => c.y < 100)).toHaveLength(3);
    expect(rect.filter((c) => c.y > 100)).toHaveLength(2);
  });

  it("arma la grilla y una butaca por silla", () => {
    const tables = seatedTablesGrid({ count: 5, perRow: 2, x: 100, y: 100, gapX: 120, gapY: 110 });
    expect(tables.map((t) => [t.number, t.x, t.y])).toEqual([[1, 100, 100], [2, 220, 100], [3, 100, 210], [4, 220, 210], [5, 100, 320]]);
    const parsed = parseSeatedTablesLayout({ ...base, tables });
    expect(parsed.ok).toBe(true);
    const seats = seatedTableSeats((parsed as { layout: SeatedTablesLayout }).layout);
    expect(seats).toHaveLength(30);
    expect(seats[7]).toMatchObject({ row: "2", number: "2", label: "Mesa 2 · silla 2" });
  });

  it("rechaza mesas encimadas, fuera del mapa o un rango imposible", () => {
    expect(parseSeatedTablesLayout({ ...base, tables: [{ number: 1, x: 100, y: 100 }, { number: 2, x: 130, y: 100 }] })).toMatchObject({ ok: false, error: expect.stringContaining("encimadas") });
    expect(parseSeatedTablesLayout({ ...base, tables: [{ number: 1, x: 5, y: 100 }] })).toMatchObject({ ok: false, error: expect.stringContaining("fuera del mapa") });
    expect(parseSeatedTablesLayout({ ...base, mode: "RANGE", min: 4, max: 2, tables: [{ number: 1, x: 200, y: 200 }] }).ok).toBe(false);
    expect(parseSeatedTablesLayout({ ...base, chairs: 12, tables: [{ number: 1, x: 200, y: 200 }] }).ok).toBe(false);
  });

  it("valida la compra según cómo se vende la mesa", () => {
    const layout = (mode: "WHOLE" | "SEAT" | "RANGE", min = 1, max = 6) => ({ ...base, mode, min, max, tables: [] }) as SeatedTablesLayout;
    expect(checkTableSelection(layout("WHOLE"), ["3", "3", "3", "3", "3", "3"])).toBeNull();
    expect(checkTableSelection(layout("WHOLE"), ["3", "3"])).toContain("completa");
    expect(checkTableSelection(layout("WHOLE"), ["3", "3"], new Map([["3", 2]]))).toContain("ya tiene sillas vendidas");
    expect(checkTableSelection(layout("SEAT"), ["1"])).toBeNull();
    expect(checkTableSelection(layout("RANGE", 2, 4), ["1", "1", "2", "2", "2"])).toBeNull();
    expect(checkTableSelection(layout("RANGE", 2, 4), ["1"])).toContain("de 2 a 4");
  });
});
