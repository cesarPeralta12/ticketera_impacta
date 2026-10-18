import { describe, expect, it } from "vitest";
import { entranceFor, entranceLabel, entranceText, reentryText } from "./entrance";

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

  it("la puerta de salida no es un ingreso y la del VIP solo para quien abre esa zona", () => {
    const principal = { name: "Puerta principal", sectionIds: [], direction: "IN" as const, zoneId: "sala" };
    const vip = { name: "Puerta VIP", sectionIds: [], direction: "IN" as const, zoneId: "vip" };
    const salida = { name: "Salida", sectionIds: [], direction: "OUT" as const, zoneId: null };
    expect(entranceText([principal, vip, salida], "platea", ["sala"])).toBe("Ingreso por: Puerta principal");
    expect(entranceText([principal, vip, salida], "balcon", ["sala", "vip"])).toBe("Ingreso por cualquier puerta");
    // Sin zonas en su tipo, entra por las de siempre (todas las de ingreso).
    expect(entranceText([principal, vip, salida], "platea", [])).toBe("Ingreso por cualquier puerta");
    expect(entranceText([salida], "platea")).toBeNull();
  });

  it("solo las entradas con reingreso lo dicen", () => {
    expect(reentryText(1)).toBeNull();
    expect(reentryText(undefined)).toBeNull();
    expect(reentryText(2)).toBe("Permite salir y volver a entrar (hasta 2 ingresos)");
    expect(reentryText(0)).toBe("Permite salir y volver a entrar");
  });
});
