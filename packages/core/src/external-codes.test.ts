import { describe, expect, it } from "vitest";
import cases from "./external-codes.cases.json";
import { excelNumberText, externalKeyCandidates, looksLikeMangledNumber, normalizeExternalCode, parseCodeRule } from "./external-codes";

describe("códigos de entradas de un tercero", () => {
  // Los mismos casos los prueba la app de puerta: si los dos los entienden igual, una entrada válida no se rechaza.
  for (const c of cases) {
    it(`${c.note}: «${c.raw}» → ${c.key ?? "nada"}`, () => {
      expect(normalizeExternalCode(c.raw, parseCodeRule(c.rule))).toBe(c.key);
    });
  }

  it("una lectura prueba las reglas de todos los lotes de la función", () => {
    const keys = externalKeyCandidates("tkt-00123", [parseCodeRule({}), parseCodeRule({ prefix: "TKT", ignoreLeadingZeros: true })]);
    expect(keys).toEqual(["TKT00123", "123"]);
  });

  it("una regla guardada incompleta toma los valores por defecto", () => {
    expect(parseCodeRule(null)).toEqual({ ignoreSeparators: true, fromUrl: true, prefix: "", suffix: "", ignoreLeadingZeros: false });
    expect(parseCodeRule({ prefix: "  TKT-  ", ignoreSeparators: false }).prefix).toBe("TKT-");
  });

  it("marca los números que Excel ya redondeó (más de 15 dígitos o notación científica)", () => {
    expect(excelNumberText("123456789012345")).toBe("123456789012345");
    expect(looksLikeMangledNumber(excelNumberText("1234567890123456800"))).toBe(true);
    expect(looksLikeMangledNumber(excelNumberText("1.2345678901234568E+18"))).toBe(true);
    expect(looksLikeMangledNumber("1.23457E+18")).toBe(true);
    // Una celda de texto con 16 dígitos es un código válido: no lleva la marca.
    expect(looksLikeMangledNumber("1234567890123456")).toBe(false);
  });
});
