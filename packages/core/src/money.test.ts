import { describe, expect, it } from "vitest";
import { formatMoney, lineTotal, minorUnitDigits } from "./money";

describe("money", () => {
  it("conoce los decimales de cada moneda", () => {
    expect(minorUnitDigits("CLP")).toBe(0);
    expect(minorUnitDigits("ARS")).toBe(2);
    expect(minorUnitDigits("BOB")).toBe(2);
    expect(minorUnitDigits("USD")).toBe(2);
  });

  it("formatea en la unidad mayor", () => {
    expect(formatMoney(25000, "CLP", "es-CL")).toBe("$25.000");
    expect(formatMoney(12000, "BOB")).toBe("Bs 120,00");
    expect(formatMoney(1999, "USD", "en-US")).toBe("$19.99");
  });

  it("calcula totales de línea en enteros", () => {
    expect(lineTotal(45000, 3)).toBe(135000);
  });

  it("rechaza montos y cantidades inválidos", () => {
    expect(() => lineTotal(10.5, 1)).toThrow(RangeError);
    expect(() => lineTotal(-1, 1)).toThrow(RangeError);
    expect(() => lineTotal(1000, 0)).toThrow(RangeError);
  });
});
