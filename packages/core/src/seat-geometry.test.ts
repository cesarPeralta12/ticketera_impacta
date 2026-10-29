import { describe, expect, it } from "vitest";
import { computeSeatPositions, seatDotRadius, seatShapeProblem, shapeSeatSpacing } from "./seat-geometry";

describe("geometría de asientos", () => {
  it("una grilla genera filas con letra y butacas numeradas", () => {
    const seats = computeSeatPositions({ type: "grid", rows: 2, seatsPerRow: 3, x: 100, y: 50, seatGap: 20, rowGap: 30 });
    expect(seats).toHaveLength(6);
    expect(seats[0]).toEqual({ row: "A", number: "1", x: 100, y: 50 });
    expect(seats[5]).toEqual({ row: "B", number: "3", x: 140, y: 80 });
  });

  it("un arco reparte las butacas sobre arcos concéntricos", () => {
    const seats = computeSeatPositions({
      type: "arc",
      rows: 2,
      seatsPerRow: 5,
      centerX: 500,
      centerY: 0,
      startRadius: 100,
      rowGap: 50,
      startAngleDeg: 0,
      spanDeg: 180,
    });
    expect(seats).toHaveLength(10);
    // Primera butaca de la fila A: ángulo 0° -> a la derecha del centro.
    expect(seats[0]!.x).toBeCloseTo(600);
    expect(seats[0]!.y).toBeCloseTo(0);
    // La fila B está más lejos del centro.
    expect(seats[5]!.x).toBeCloseTo(650);
  });

  // La Tribuna Sur del plano de prueba: 10 filas de 30, a 17,5 entre butacas y 11 entre filas.
  const tribuna = { type: "grid" as const, rows: 10, seatsPerRow: 30, x: 248, y: 504, seatGap: 17.5, rowGap: 11 };

  it("una tribuna apretada entra en el mapa y su punto se achica para que no se pisen", () => {
    expect(seatShapeProblem(tribuna)).toBeNull();
    expect(shapeSeatSpacing(tribuna)).toBe(11);
    expect(seatDotRadius(computeSeatPositions(tribuna))).toBe(5);
    // Con lugar de sobra, el punto de siempre.
    expect(seatDotRadius(computeSeatPositions({ ...tribuna, seatGap: 25, rowGap: 24 }))).toBe(7);
  });

  it("no deja guardar butacas fuera del mapa ni pegadas", () => {
    expect(seatShapeProblem({ ...tribuna, seatsPerRow: 60, seatGap: 30 })).toMatch(/fuera del mapa/);
    expect(seatShapeProblem({ ...tribuna, y: 620 })).toMatch(/fuera del mapa/);
    expect(seatShapeProblem({ ...tribuna, rowGap: 5 })).toMatch(/demasiado juntas/);
    // Una sola fila: el espacio entre filas no importa.
    expect(seatShapeProblem({ ...tribuna, rows: 1, rowGap: 0 })).toBeNull();
    // En el arco cuenta lo juntas que quedan las butacas de la primera fila.
    const arc = { type: "arc" as const, rows: 2, seatsPerRow: 60, centerX: 500, centerY: 0, startRadius: 100, rowGap: 30, startAngleDeg: 0, spanDeg: 180 };
    expect(seatShapeProblem(arc)).toMatch(/demasiado juntas/);
    expect(seatShapeProblem({ ...arc, seatsPerRow: 20 })).toBeNull();
  });
});
