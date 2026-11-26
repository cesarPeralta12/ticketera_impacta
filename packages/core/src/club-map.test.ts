import { describe, expect, it } from "vitest";
import { TABLE_RADIUS, defaultMapItem, hasStage, isTablesLayout, isWholeTablesLayout, mapItemLabel, nextTableNumber, parseMapItems, parseTables, parseWholeTables, tableName } from "./club-map";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./seat-geometry";

describe("elementos del plano", () => {
  it("un elemento nuevo queda centrado en el punto y dentro del lienzo", () => {
    const stage = defaultMapItem("STAGE", { x: 500, y: 40 }, "s1");
    expect(stage).toMatchObject({ kind: "STAGE", label: "Escenario", width: 320, height: 60, x: 340, y: 10 });
    const corner = defaultMapItem("BAR", { x: 0, y: 0 }, "b1");
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
  });

  it("valida lo que manda el editor: tipo conocido, números y dentro del lienzo", () => {
    const items = parseMapItems([
      { id: "a", kind: "BAR", label: "  Barra principal  ", x: 990, y: -20, width: 200, height: 40 },
      { id: "b", kind: "STAGE", label: "", x: 10, y: 10, width: 5, height: 5 },
    ]);
    expect(items).toEqual([
      { id: "a", kind: "BAR", label: "Barra principal", x: CANVAS_WIDTH - 200, y: 0, width: 200, height: 40 },
      { id: "b", kind: "STAGE", label: "Escenario", x: 10, y: 10, width: 20, height: 20 },
    ]);
    expect(hasStage(items)).toBe(true);
    expect(parseMapItems([{ kind: "PISCINA", x: 0, y: 0, width: 10, height: 10 }])).toBeNull();
    expect(parseMapItems("nada")).toBeNull();
  });

  it("el nombre puede ir vertical (ej. una puerta en una pared de costado)", () => {
    const [door, bar] = parseMapItems([
      { id: "p", kind: "ENTRANCE", label: "Puerta 2", x: 960, y: 200, width: 36, height: 140, vertical: true },
      { id: "b", kind: "BAR", label: "Barra", x: 100, y: 100, width: 200, height: 40, vertical: "sí" },
    ])!;
    expect(door!.vertical).toBe(true);
    expect(bar).not.toHaveProperty("vertical");
    // Vertical: el texto gira sobre el centro de la caja y su tamaño sigue al ancho; horizontal, al alto y sin giro.
    expect(mapItemLabel(door!)).toEqual({ x: 978, y: 275, fontSize: Math.min(16, Math.max(10, 36 / 2.6)), transform: "rotate(-90 978 270)" });
    expect(mapItemLabel(bar!)).toEqual({ x: 200, y: 125, fontSize: Math.min(16, Math.max(10, 40 / 2.6)) });
  });
});

describe("lounges en círculo", () => {
  it("se reconocen, se nombran y se numeran", () => {
    expect(isTablesLayout({ type: "tables", radius: 18, prefix: "Lounge" })).toBe(true);
    expect(isTablesLayout({ type: "grid" })).toBe(false);
    expect(tableName("Lounge", 3)).toBe("Lounge 3");
    expect(nextTableNumber([{ number: 1 }, { number: 4 }])).toBe(5);
    expect(nextTableNumber([])).toBe(1);
  });

  it("ordena por número y los mantiene dentro del lienzo", () => {
    const result = parseTables([
      { number: 2, x: 200, y: 200 },
      { id: "x", number: 1, x: -50, y: CANVAS_HEIGHT + 50 },
    ]);
    expect(result).toEqual({
      ok: true,
      tables: [
        { id: "x", number: 1, x: 18, y: CANVAS_HEIGHT - 18 },
        { number: 2, x: 200, y: 200 },
      ],
    });
  });

  it("no acepta números repetidos, círculos encimados ni un grupo vacío", () => {
    expect(parseTables([])).toMatchObject({ ok: false });
    expect(parseTables([{ number: 1, x: 100, y: 100 }, { number: 1, x: 300, y: 100 }])).toMatchObject({ ok: false });
    expect(parseTables([{ number: 1, x: 100, y: 100 }, { number: 2, x: 110, y: 100 }])).toMatchObject({
      ok: false,
      error: "Los lounges 1 y 2 están encimados: sepáralos un poco.",
    });
  });
});

describe("mesas que se venden completas", () => {
  const tables = [
    { number: 1, x: 120, y: 120 },
    { number: 2, x: 220, y: 120 },
  ];

  it("arma un grupo de mesas en círculo con sus personas", () => {
    const result = parseWholeTables({ prefix: " Mesa ", shape: "round", people: 10, tables });
    expect(result).toMatchObject({ ok: true, layout: { type: "tables", radius: TABLE_RADIUS, prefix: "Mesa", shape: "round", people: 10 } });
    expect(result.ok && result.tables.map((t) => t.number)).toEqual([1, 2]);
    expect(isWholeTablesLayout(result.ok && result.layout)).toBe(true);
    expect(isWholeTablesLayout({ type: "tables", radius: 18, prefix: "Lounge" })).toBe(false);
  });

  it("pide personas válidas, forma y nombre, y avisa de mesas encimadas", () => {
    expect(parseWholeTables({ prefix: "Mesa", shape: "round", people: 1, tables })).toMatchObject({ ok: false, error: "Cada mesa es para 2 a 50 personas." });
    expect(parseWholeTables({ prefix: "Mesa", shape: "round", people: 51, tables })).toMatchObject({ ok: false });
    expect(parseWholeTables({ prefix: "Mesa", shape: "oval", people: 10, tables })).toMatchObject({ ok: false });
    expect(parseWholeTables({ prefix: " ", shape: "round", people: 10, tables })).toMatchObject({ ok: false });
    expect(parseWholeTables({ prefix: "Mesa", shape: "round", people: 10, tables: [{ number: 1, x: 100, y: 100 }, { number: 2, x: 110, y: 100 }] })).toMatchObject({
      ok: false,
      error: "Las mesas 1 y 2 están encimadas: sepáralas un poco.",
    });
    // Los rectángulos son más anchos: lo que entra en círculos puede quedar encimado.
    expect(parseWholeTables({ prefix: "Mesa", shape: "rect", people: 10, tables: [{ number: 1, x: 100, y: 100 }, { number: 2, x: 140, y: 100 }] })).toMatchObject({ ok: false });
  });
});
