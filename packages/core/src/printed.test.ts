import { describe, expect, it } from "vitest";
import { canMovePrinted, formatSerial, nextPrefix, normalizePrefix, parseSerialRange, printedOpensDoor, serialNumber } from "./printed";

describe("serie de las entradas impresas", () => {
  it("formatea y lee la serie", () => {
    expect(formatSerial("A", 7)).toBe("A-0007");
    expect(formatSerial("VIP", 12345)).toBe("VIP-12345");
    expect(serialNumber("a-0007", "A")).toBe(7);
    expect(serialNumber("B-0007", "A")).toBeNull();
  });

  it("prefijos", () => {
    expect(normalizePrefix(" vip ")).toBe("VIP");
    expect(normalizePrefix("A-1")).toBeNull();
    expect(nextPrefix([])).toBe("A");
    expect(nextPrefix(["A", "b"])).toBe("C");
    expect(nextPrefix(Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)))).toBe("AA");
  });

  it("rangos como los escribe la gente", () => {
    expect(parseSerialRange("1-20")).toEqual({ ok: true, from: 1, to: 20 });
    expect(parseSerialRange("del 0001 al 0020")).toEqual({ ok: true, from: 1, to: 20 });
    expect(parseSerialRange("A-0003 a A-0010")).toEqual({ ok: true, from: 3, to: 10 });
    expect(parseSerialRange("7")).toEqual({ ok: true, from: 7, to: 7 });
    expect(parseSerialRange("20-1").ok).toBe(false);
    expect(parseSerialRange("hola").ok).toBe(false);
  });
});

describe("estados", () => {
  it("cambios permitidos", () => {
    expect(canMovePrinted("STOCK", "ASSIGNED")).toBe(true);
    expect(canMovePrinted("ASSIGNED", "SOLD")).toBe(true);
    expect(canMovePrinted("SOLD", "RETURNED")).toBe(false);
    expect(canMovePrinted("SOLD", "VOID")).toBe(true);
    expect(canMovePrinted("VOID", "STOCK")).toBe(false);
    expect(canMovePrinted("STOCK", "SOLD", true)).toBe(false);
  });

  it("quién abre la puerta", () => {
    expect(printedOpensDoor("ACTIVATE_ON_SALE", "STOCK")).toBe(false);
    expect(printedOpensDoor("ACTIVATE_ON_SALE", "SOLD")).toBe(true);
    expect(printedOpensDoor("VALID_ON_PRINT", "STOCK")).toBe(true);
    expect(printedOpensDoor("VALID_ON_PRINT", "VOID")).toBe(false);
  });
});
