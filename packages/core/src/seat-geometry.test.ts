import { describe, expect, it } from "vitest";
import { computeSeatPositions } from "./seat-geometry";

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
});
