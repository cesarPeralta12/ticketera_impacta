import { describe, expect, it } from "vitest";
import { entranceFor, entranceLabel, entranceText } from "./entrance";

const norte = { name: "Acceso norte", sectionIds: ["campo"] };
const sur = { name: "Acceso sur", sectionIds: ["palco"] };
const libre = { name: "Puerta principal", sectionIds: [] };

describe("por qué puerta entra una entrada", () => {
  it("con puertas por sección, cada entrada entra por la suya", () => {
    expect(entranceText([norte, sur], "campo")).toBe("Ingreso por: Acceso norte");
    expect(entranceText([norte, sur], "palco")).toBe("Ingreso por: Acceso sur");
  });

  it("con una sola puerta sin secciones, dice su nombre", () => {
    expect(entranceText([libre], "campo")).toBe("Ingreso por: Puerta principal");
    expect(entranceText([libre], null)).toBe("Ingreso por: Puerta principal");
  });

  it("si todas las puertas la aceptan, 'cualquier puerta'", () => {
    expect(entranceFor([libre, { name: "Puerta 2", sectionIds: [] }], "campo")).toEqual({ kind: "any" });
    expect(entranceText([libre, { name: "Puerta 2", sectionIds: [] }], "campo")).toBe("Ingreso por cualquier puerta");
    // Dos puertas que ambas incluyen la sección también equivalen a "cualquiera".
    expect(entranceFor([{ ...norte }, { name: "Acceso este", sectionIds: ["campo", "palco"] }], "campo")).toEqual({ kind: "any" });
  });

  it("mezcla de puertas con y sin secciones: lista las que la aceptan", () => {
    expect(entranceText([norte, sur, libre], "campo")).toBe("Ingreso por: Acceso norte o Puerta principal");
    expect(entranceText([norte, { name: "Acceso este", sectionIds: ["campo"] }, sur, libre], "campo")).toBe(
      "Ingreso por: Acceso norte, Acceso este o Puerta principal",
    );
  });

  it("sin puertas, o con una sección que ninguna recibe, no dice nada", () => {
    expect(entranceText([], "campo")).toBeNull();
    expect(entranceText([norte, sur], "otra")).toBeNull();
    expect(entranceText([norte, sur], null)).toBeNull();
    expect(entranceLabel({ kind: "none" })).toBeNull();
  });
});
