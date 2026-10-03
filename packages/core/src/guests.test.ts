import { describe, expect, it } from "vitest";
import { parseGuestList } from "./guests";

describe("parseGuestList", () => {
  it("lee columnas pegadas desde Excel y saltea el encabezado", () => {
    const text = "Nombre\tEmail\tCI\nAna Pérez\tana@correo.bo\t1234567\nLuis Rojas\t\t7654321\n";
    expect(parseGuestList(text)).toEqual({
      guests: [
        { name: "Ana Pérez", email: "ana@correo.bo", document: "1234567" },
        { name: "Luis Rojas", document: "7654321" },
      ],
      errors: [],
    });
  });

  it("acepta CSV con punto y coma (Excel en español) o coma, y solo nombres", () => {
    expect(parseGuestList("﻿Ana;ANA@Correo.bo\r\nLuis, luis@correo.bo\nMarta").guests).toEqual([
      { name: "Ana", email: "ana@correo.bo" },
      { name: "Luis", email: "luis@correo.bo" },
      { name: "Marta" },
    ]);
  });

  it("el email y el documento pueden venir en cualquier orden", () => {
    expect(parseGuestList("Ana, 1234567, ana@correo.bo").guests).toEqual([
      { name: "Ana", email: "ana@correo.bo", document: "1234567" },
    ]);
  });

  it("marca líneas sin nombre, emails inválidos y repetidos con su número de línea", () => {
    const { guests, errors } = parseGuestList("Ana, ana@correo.bo\n, x@y.bo\nLuis, luis@\nana , ana@correo.bo");
    expect(guests).toEqual([{ name: "Ana", email: "ana@correo.bo" }]);
    expect(errors).toEqual([
      "Línea 2: falta el nombre.",
      "Línea 3: email inválido (luis@).",
      "Línea 4: ana está repetido (línea 1).",
    ]);
  });
});
