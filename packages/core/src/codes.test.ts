import { describe, expect, it } from "vitest";
import { formatCode, isValidCode, randomCode } from "./codes";

describe("códigos", () => {
  it("genera códigos del largo pedido y con el alfabeto seguro", () => {
    for (let i = 0; i < 200; i++) {
      const code = randomCode();
      expect(code).toHaveLength(10);
      expect(isValidCode(code)).toBe(true);
      expect(code).not.toMatch(/[01ILO]/);
    }
  });

  it("no repite códigos en una muestra grande", () => {
    const codes = new Set(Array.from({ length: 10_000 }, () => randomCode()));
    expect(codes.size).toBe(10_000);
  });

  it("formatea y valida con guion", () => {
    expect(formatCode("K7Q3MXPA2B")).toBe("K7Q3M-XPA2B");
    expect(isValidCode("k7q3m-xpa2b")).toBe(true);
    expect(isValidCode("K7Q3M-XPA20")).toBe(false);
  });
});
