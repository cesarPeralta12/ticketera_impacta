import { describe, expect, it } from "vitest";
import { formatDateTime, slugify, utcToZonedInput, zonedDateTimeToUtc } from "./locale";
import { formatMoney } from "./money";

describe("configuración regional (Bolivia)", () => {
  it("formatea bolivianos", () => {
    expect(formatMoney(12_000, "BOB")).toBe("Bs 120,00");
    expect(formatMoney(123_450, "BOB")).toBe("Bs 1.234,50");
  });

  it("interpreta la hora del organizador en la zona del recinto, no del servidor", () => {
    // 21:00 en La Paz (UTC-4) = 01:00 UTC del día siguiente.
    expect(zonedDateTimeToUtc("2026-11-20T21:00", "America/La_Paz").toISOString()).toBe(
      "2026-11-21T01:00:00.000Z",
    );
    // Misma hora de pared en Santiago (UTC-3 en noviembre por horario de verano).
    expect(zonedDateTimeToUtc("2026-11-20T21:00", "America/Santiago").toISOString()).toBe(
      "2026-11-21T00:00:00.000Z",
    );
  });

  it("ida y vuelta entre UTC y el formulario", () => {
    const utc = zonedDateTimeToUtc("2026-12-31T23:30", "America/La_Paz");
    expect(utcToZonedInput(utc, "America/La_Paz")).toBe("2026-12-31T23:30");
  });

  it("muestra la hora del recinto", () => {
    expect(formatDateTime(new Date("2026-11-21T01:00:00Z"), "America/La_Paz")).toContain("21:00");
  });

  it("rechaza fechas mal formadas", () => {
    expect(() => zonedDateTimeToUtc("20/11/2026", "America/La_Paz")).toThrow(RangeError);
  });

  it("genera slugs sin tildes ni símbolos", () => {
    expect(slugify("Noche Electrónica: Alok Bolivia")).toBe("noche-electronica-alok-bolivia");
    expect(slugify('Estadio "Tahuichi" Ramón Aguilera')).toBe("estadio-tahuichi-ramon-aguilera");
  });
});
