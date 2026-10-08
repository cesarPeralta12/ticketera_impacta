import { describe, expect, it } from "vitest";
import { isValidDocument, normalizeDocument } from "./accounts";

describe("carnet de identidad", () => {
  it("normaliza espacios, puntos, guiones y mayúsculas", () => {
    expect(normalizeDocument(" 1.234.567-lp ")).toBe("1234567LP");
    expect(normalizeDocument("1234567 1a")).toBe("12345671A");
  });

  it("valida largo y cantidad de números", () => {
    expect(isValidDocument("1234567")).toBe(true);
    expect(isValidDocument("1234567LP")).toBe(true);
    expect(isValidDocument("A1234567B")).toBe(true);
    expect(isValidDocument("1234")).toBe(false);
    expect(isValidDocument("ABCDEFGHI")).toBe(false);
    expect(isValidDocument("1234567890123456")).toBe(false);
  });
});
