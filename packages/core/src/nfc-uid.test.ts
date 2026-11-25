import { describe, expect, it } from "vitest";
import cases from "./nfc-uid.cases.json";
import { normalizeNfcUid, parseReaderUid, sanitizeNfcCard } from "./nfc-uid";

describe("número de serie de una tarjeta NFC", () => {
  // Los mismos casos los prueban las apps de puerta y de canje: si los tres lo entienden igual, una tarjeta vinculada
  // en una se reconoce en la otra.
  for (const c of cases) {
    it(`${c.note}: «${c.raw}» → ${c.uid ?? "nada"}`, () => {
      expect(normalizeNfcUid(c.raw)).toBe(c.uid);
    });
  }
});

describe("huella de la tarjeta", () => {
  it("conserva solo los campos conocidos y acota los largos", () => {
    const card = sanitizeNfcCard("047F8C520F7A80", {
      uid: "FALSO",
      type: "ISO 14443-3A",
      model: "Mifare Ultralight",
      tech: ["NfcA", "MifareUltralight", "Ndef", 5, "", "x".repeat(100)],
      atqa: "0044",
      sak: "00",
      extra: "no entra",
    });
    expect(card.uid).toBe("047F8C520F7A80");
    expect(card.type).toBe("ISO 14443-3A");
    expect(card.model).toBe("Mifare Ultralight");
    expect(card.tech?.slice(0, 3)).toEqual(["NfcA", "MifareUltralight", "Ndef"]);
    expect(card.tech?.[3]).toHaveLength(40);
    expect(card).not.toHaveProperty("extra");
  });

  it("sin cuerpo queda solo el UID", () => {
    expect(sanitizeNfcCard("A1B2C3D4", null)).toEqual({ uid: "A1B2C3D4" });
    expect(sanitizeNfcCard("A1B2C3D4", "texto")).toEqual({ uid: "A1B2C3D4" });
  });
});

describe("número de serie que escribe un lector USB", () => {
  it("acepta hexadecimal, con o sin separadores", () => {
    expect(parseReaderUid("04:7F:8C:52:0F:7A:80")).toBe("047F8C520F7A80");
    expect(parseReaderUid(" 047f8c520f7a80 ")).toBe("047F8C520F7A80");
  });

  it("invierte los bytes cuando el lector los entrega al revés", () => {
    expect(parseReaderUid("807A0F528C7F04", "REVERSED")).toBe("047F8C520F7A80");
  });

  it("rechaza un lector en decimal o una lectura que no es un número de serie", () => {
    expect(parseReaderUid("0012345678")).toBeNull();
    expect(parseReaderUid("ABC123")).toBeNull();
    expect(parseReaderUid("")).toBeNull();
  });
});
