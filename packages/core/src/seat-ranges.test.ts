import { describe, expect, it } from "vitest";
import { parseSeatRanges, resolveSeatRanges, type RangeSeat } from "./seat-ranges";

const seats: RangeSeat[] = ["A", "B"].flatMap((row) => Array.from({ length: 60 }, (_, i) => ({ id: `${row}${i + 1}`, section: "Platea", row, number: String(i + 1) })));

describe("rangos de butacas", () => {
  it("lee rangos, números sueltos y prefijos", () => {
    expect(parseSeatRanges("A 1-20, 40 al 50; 7").items).toEqual([
      { text: "A 1-20", prefix: "a", from: 1, to: 20 },
      { text: "40 al 50", prefix: "", from: 40, to: 50 },
      { text: "7", prefix: "", from: 7, to: 7 },
    ]);
    expect(parseSeatRanges("Fila B: 5-9").items[0]).toMatchObject({ prefix: "fila b", from: 5, to: 9 });
    expect(parseSeatRanges("hola").invalid).toEqual(["hola"]);
  });

  it("elige solo la fila indicada y sin fila vale para todas", () => {
    expect(resolveSeatRanges("A 1-3", seats).ids).toEqual(["A1", "A2", "A3"]);
    expect(resolveSeatRanges("Fila B 2-3", seats).ids).toEqual(["B2", "B3"]);
    expect(resolveSeatRanges("Platea A 58-60", seats).ids).toEqual(["A58", "A59", "A60"]);
    expect(resolveSeatRanges("1-2", seats).ids).toEqual(["A1", "A2", "B1", "B2"]);
  });

  it("junta varios rangos sin repetir y avisa los que no encuentran nada", () => {
    const r = resolveSeatRanges("A 1-3, A 2-4, Z 1-5, A 70-80", seats);
    expect(r.ids).toEqual(["A1", "A2", "A3", "A4"]);
    expect(r.empty).toEqual(["Z 1-5", "A 70-80"]);
  });

  it("un rango escrito al revés se corrige", () => {
    expect(resolveSeatRanges("A 3-1", seats).ids).toEqual(["A1", "A2", "A3"]);
  });
});
