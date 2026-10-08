import { describe, expect, it } from "vitest";
import { saleState, windowsOverlap } from "./sale-window";

const d = (iso: string) => new Date(iso);
const now = d("2026-10-10T12:00:00Z");

describe("saleState", () => {
  it("sin fechas siempre está a la venta", () => {
    expect(saleState({ salesStartAt: null, salesEndAt: null }, now)).toBe("open");
  });

  it("una preventa vende hasta su fecha de fin y después queda cerrada", () => {
    const presale = { salesStartAt: null, salesEndAt: d("2026-10-10T23:59:00Z") };
    expect(saleState(presale, now)).toBe("open");
    expect(saleState(presale, d("2026-10-10T23:59:00Z"))).toBe("closed");
  });

  it("un tipo que empieza más adelante está programado", () => {
    expect(saleState({ salesStartAt: d("2026-10-11T00:00:00Z"), salesEndAt: null }, now)).toBe("scheduled");
  });
});

describe("windowsOverlap", () => {
  const presale = { salesStartAt: null, salesEndAt: d("2026-10-20T00:00:00Z") };

  it("preventa y general consecutivas no se superponen", () => {
    expect(windowsOverlap(presale, { salesStartAt: d("2026-10-20T00:00:00Z"), salesEndAt: null })).toBe(false);
  });

  it("dos tipos sin fechas, o con fechas que se cruzan, se superponen", () => {
    expect(windowsOverlap({ salesStartAt: null, salesEndAt: null }, { salesStartAt: null, salesEndAt: null })).toBe(true);
    expect(windowsOverlap(presale, { salesStartAt: d("2026-10-15T00:00:00Z"), salesEndAt: null })).toBe(true);
  });
});
