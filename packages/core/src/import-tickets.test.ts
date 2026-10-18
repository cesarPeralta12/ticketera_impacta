import { describe, expect, it } from "vitest";
import { matchImportSession, parseDelimited, parseImportAmount, parseImportTable, placeKey } from "./import-tickets";

describe("parseImportTable", () => {
  it("reconoce las columnas por su título, en cualquier orden", () => {
    const { rows, errors, total } = parseImportTable([
      ["Nombre", "CI", "Tipo", "Email", "Monto"],
      ["Ana Pérez", "123 LP", "General", "ANA@correo.bo", "150,50"],
      ["", "", "", "", ""],
      ["Juan Rojas", "", "VIP", "", ""],
    ]);
    expect(errors).toEqual([]);
    expect(total).toBe(2);
    expect(rows).toEqual([
      { line: 2, session: "", type: "General", name: "Ana Pérez", document: "123 LP", email: "ana@correo.bo", place: null, amount: 15_050 },
      { line: 4, session: "", type: "VIP", name: "Juan Rojas", document: null, email: null, place: null, amount: 0 },
    ]);
  });

  it("señala cada fila con su problema y el carnet repetido", () => {
    const { rows, errors } = parseImportTable([
      ["Tipo de entrada", "Nombre", "Carnet", "Correo", "Monto cobrado (Bs)"],
      ["General", "A", "", "", ""],
      ["General", "Ana", "5544", "ana@", ""],
      ["General", "Luis", "55 44", "", "diez"],
      ["General", "Eva", "5544", "", ""],
    ]);
    expect(rows).toHaveLength(0);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(errors[0]!.message).toBe("Falta el nombre.");
    expect(errors[1]!.message).toContain("orreo inválido");
    expect(errors[2]!.message).toContain("onto inválido");
    // "55 44" ya cuenta como el carnet 5544 de la fila 3 aunque esa fila tenga otro error.
    expect(errors[3]!.message).toContain("repetido (fila 3)");
  });

  it("exige los títulos", () => {
    expect(parseImportTable([["Juan", "General"]]).errors[0]!.message).toContain("títulos");
  });
});

describe("parseImportAmount", () => {
  it("lee montos como los escribe la gente", () => {
    expect(parseImportAmount("")).toBe(0);
    expect(parseImportAmount("150")).toBe(15_000);
    expect(parseImportAmount("Bs 1.500,50")).toBe(150_050);
    expect(parseImportAmount("99.9")).toBe(9_990);
    expect(parseImportAmount("-5")).toBeNull();
  });
});

describe("parseDelimited", () => {
  it("respeta comillas y el separador de Excel en español", () => {
    expect(parseDelimited('Nombre;Tipo\r\n"Pérez; Juan";General\r\n"Dice ""hola""";VIP')).toEqual([
      ["Nombre", "Tipo"],
      ["Pérez; Juan", "General"],
      ['Dice "hola"', "VIP"],
    ]);
  });
});

describe("matchImportSession", () => {
  const sessions = [
    { id: "a", label: "1. vie, 20 nov 2026, 20:00 · Teatro", startsAt: new Date("2026-11-21T00:00:00Z"), timeZone: "America/La_Paz" },
    { id: "b", label: "2. sáb, 21 nov 2026, 20:00 · Teatro", startsAt: new Date("2026-11-22T00:00:00Z"), timeZone: "America/La_Paz" },
  ];
  it("por el texto de la lista, el número o la fecha", () => {
    expect(matchImportSession("1. VIE, 20 nov 2026, 20:00 · teatro", sessions)?.id).toBe("a");
    expect(matchImportSession("2", sessions)?.id).toBe("b");
    expect(matchImportSession("2026-11-21", sessions)?.id).toBe("b");
    expect(matchImportSession("", sessions)).toBeNull();
    expect(matchImportSession("", [sessions[0]!])?.id).toBe("a");
    expect(matchImportSession("7", sessions)).toBeNull();
  });
});

describe("placeKey", () => {
  it("compara butacas y mesas escritas a mano", () => {
    expect(placeKey("Fila F · 12")).toBe("f-12");
    expect(placeKey("F-12")).toBe(placeKey("f12"));
    expect(placeKey("Mesa 5")).toBe("5");
    expect(placeKey("Fila N · 3")).toBe("n-3");
    expect(placeKey("Fila 1 · 12")).not.toBe(placeKey("Fila 11 · 2"));
  });
});
