import { describe, expect, it } from "vitest";
import { DEFAULT_CODE_RULE, excelNumberText } from "./external-codes";
import { detectHeaderRow, parseMappedTable, suggestMapping, summarizeColumns, valueKey, type ImportMapping } from "./import-mapping";

/** Un Excel de otro proveedor: título arriba, columnas en otro orden y con otros nombres. */
const FILE = [
  ["Reporte de ventas TuBoleto", "", "", "", ""],
  ["", "", "", "", ""],
  ["Comprador", "C.I.", "Localidad", "Nº de entrada", "Pagado (Bs)"],
  ["Ana Pérez", "4455667", "VIP", "VIP-2026-0001", "450"],
  ["Luis Rojas", "", "vip", "VIP-2026-0002", "450"],
  ["Marta Quispe", "7788990", "General ", "GEN-2026-0003", "150"],
];

const mapping = (overrides: Partial<ImportMapping> = {}): ImportMapping => ({
  headerRow: 2,
  columns: { name: 0, document: 1, type: 2, code: 3, amount: 4 },
  fixed: {},
  values: { type: { [valueKey("VIP")]: "VIP", [valueKey("General")]: "General" } },
  codeRule: DEFAULT_CODE_RULE,
  ...overrides,
});

describe("importar con cualquier formato", () => {
  it("encuentra la fila de títulos aunque arriba haya un título", () => {
    expect(detectHeaderRow(FILE)).toBe(2);
  });

  it("resume cada columna y sugiere qué es cada una (por el título y por la forma de los valores)", () => {
    const columns = summarizeColumns(FILE, 2);
    expect(columns.map((c) => c.title)).toEqual(["Comprador", "C.I.", "Localidad", "Nº de entrada", "Pagado (Bs)"]);
    // "VIP" y "vip" son el mismo valor; "General " también se reconoce sin el espacio.
    expect(columns[2]!.distinct).toEqual([
      { value: "VIP", count: 2 },
      { value: "General", count: 1 },
    ]);
    expect(suggestMapping(columns)).toEqual({ code: 3, name: 0, document: 1, type: 2, amount: 4 });

    // Sin un título reconocible, el código es la columna sin repetidos y sin espacios.
    const bare = [["A", "B"], ["Ana Pérez", "X1"], ["Luis Rojas", "X2"]];
    expect(suggestMapping(summarizeColumns(bare, 0)).code).toBe(1);
  });

  it("arma las filas con el emparejamiento: tipo por valores, código limpio y nombre", () => {
    const { rows, errors, total } = parseMappedTable(FILE, mapping());
    expect(errors).toEqual([]);
    expect(total).toBe(3);
    expect(rows.map((r) => [r.line, r.name, r.type, r.externalCode, r.externalKey, r.amount])).toEqual([
      [4, "Ana Pérez", "VIP", "VIP-2026-0001", "VIP20260001", 45_000],
      [5, "Luis Rojas", "VIP", "VIP-2026-0002", "VIP20260002", 45_000],
      [6, "Marta Quispe", "General", "GEN-2026-0003", "GEN20260003", 15_000],
    ]);
  });

  it("sin columna de tipo, un solo tipo para todas («todas son VIP»)", () => {
    const { rows } = parseMappedTable(FILE, mapping({ columns: { name: 0, code: 3 }, fixed: { type: "VIP" }, values: {} }));
    expect(rows.every((r) => r.type === "VIP")).toBe(true);
  });

  it("errores por fila: código repetido (con la fila que ya lo tiene), valor sin emparejar y número redondeado por Excel", () => {
    const file = [
      ["Nombre", "Código", "Tipo"],
      ["Ana", "abc-1", "VIP"],
      ["Luis", "ABC 1", "VIP"],
      ["Marta", "X9", "Palco"],
      ["Juan", excelNumberText("1234567890123456800"), "VIP"],
      ["Sin código", "", "VIP"],
    ];
    const { rows, errors } = parseMappedTable(file, {
      headerRow: 0,
      columns: { name: 0, code: 1, type: 2 },
      fixed: {},
      values: { type: { vip: "VIP" } },
      codeRule: DEFAULT_CODE_RULE,
    });
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(errors[0]!.message).toMatch(/ABC 1 está repetido \(fila 2\)/);
    expect(errors[1]!.message).toMatch(/«Palco» no está emparejado/);
    expect(errors[2]!.message).toMatch(/formatea esa columna como texto/);
    // Una fila sin código es válida: recibe uno propio de iPass al confirmar.
    expect(rows.map((r) => [r.name, r.externalKey])).toEqual([
      ["Ana", "ABC1"],
      ["Sin código", null],
    ]);
  });
});
