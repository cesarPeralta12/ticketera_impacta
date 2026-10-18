import { describe, expect, it } from "vitest";
import { bestAvailableSeats, orphanSeats, type PickSeat } from "./seat-picking";

/** Fila A (adelante, y = 100) y fila B (y = 130), 6 butacas cada una; x del 1 al 6 alrededor del centro (500). */
function hall(taken: string[] = []): PickSeat[] {
  return ["A", "B"].flatMap((row, r) =>
    Array.from({ length: 6 }, (_, i) => {
      const id = `${row}${i + 1}`;
      return { id, row, number: String(i + 1), x: 425 + i * 30, y: 100 + r * 30, taken: taken.includes(id) };
    }),
  );
}

describe("asientos huérfanos", () => {
  it("detecta el asiento que queda suelto entre lo elegido y lo vendido", () => {
    const seats = hall(["A1"]);
    expect(orphanSeats(seats, new Set(["A3", "A4"])).map((s) => s.id)).toEqual(["A2"]);
    expect(orphanSeats(seats, new Set(["A2", "A3"]))).toEqual([]);
    // Junto al borde de la fila también cuenta.
    expect(orphanSeats(hall(), new Set(["A2"])).map((s) => s.id)).toEqual(["A1"]);
    // Uno que ya estaba suelto (A2 entre A1 y A3 vendidos) no es culpa de esta compra.
    expect(orphanSeats(hall(["A1", "A3"]), new Set(["B1"]))).toEqual([]);
  });
});

describe("mejor disponible", () => {
  it("elige los N juntos más adelante y al centro, sin dejar uno suelto", () => {
    expect(bestAvailableSeats(hall(), 2)!.map((s) => s.id)).toEqual(["A3", "A4"]);
    // Con A3 vendida, no deja suelto el A2 (A1-A2 o A4-A5 sin huecos sueltos).
    const pick = bestAvailableSeats(hall(["A3"]), 2)!.map((s) => s.id);
    expect(orphanSeats(hall(["A3"]), new Set(pick))).toEqual([]);
    expect(pick.every((id) => id.startsWith("A"))).toBe(true);
    // Si adelante no entran juntos, va a la fila de atrás (B1-B3: B2-B4 dejaría suelto el B1).
    expect(bestAvailableSeats(hall(["A2", "A4"]), 3)!.map((s) => s.id)).toEqual(["B1", "B2", "B3"]);
    expect(bestAvailableSeats(hall(["A3", "B3"]), 4)).toBeNull();
  });
});
