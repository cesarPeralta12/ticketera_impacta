import { describe, expect, it } from "vitest";
import { currentPrice, discountActive, discountedAmount, saleStage } from "./pricing";

const end = new Date("2026-10-20T23:59:00Z");
const type = { unitAmount: 10_000, discountPercent: 20, discountStartsAt: null, discountEndsAt: end };

describe("precio con descuento de preventa", () => {
  it("cobra el precio con descuento mientras dura la ventana", () => {
    const p = currentPrice(type, new Date("2026-10-10T12:00:00Z"));
    expect(p).toMatchObject({ unitAmount: 8_000, listAmount: 10_000, discountPercent: 20 });
    expect(p.discountEndsAt).toEqual(end);
  });

  it("al terminar la fecha vuelve al precio normal", () => {
    expect(currentPrice(type, end).unitAmount).toBe(10_000);
    expect(currentPrice(type, new Date("2026-10-21T00:00:00Z")).discountPercent).toBeNull();
  });

  it("respeta la fecha de inicio del descuento", () => {
    const later = { ...type, discountStartsAt: new Date("2026-10-15T00:00:00Z") };
    expect(discountActive(later, new Date("2026-10-14T23:00:00Z"))).toBe(false);
    expect(discountActive(later, new Date("2026-10-15T00:00:00Z"))).toBe(true);
  });

  it("sin porcentaje o sin fecha de fin no hay descuento", () => {
    expect(discountActive({ ...type, discountPercent: null })).toBe(false);
    expect(discountActive({ ...type, discountEndsAt: null })).toBe(false);
    expect(discountActive({ ...type, discountPercent: 0 })).toBe(false);
  });

  it("redondea al centavo más cercano", () => {
    expect(discountedAmount(9_999, 15)).toBe(8_499); // 8499.15
    expect(discountedAmount(5_000, 33)).toBe(3_350);
  });
});

describe("saleStage", () => {
  const window = { discountPercent: 20, discountStartsAt: null, discountEndsAt: new Date("2026-10-20T00:00:00Z") };
  const none = { discountPercent: null, discountStartsAt: null, discountEndsAt: null };

  it("preventa mientras dura el descuento; después, venta", () => {
    expect(saleStage(window, new Date("2026-10-10T00:00:00Z"))).toBe("Preventa");
    expect(saleStage(window, new Date("2026-10-21T00:00:00Z"))).toBe("Venta");
  });

  it("una fase de venta se nombra con su número, sola o con la preventa", () => {
    expect(saleStage({ ...none, phaseOrder: 2 }, new Date())).toBe("Fase 2");
    expect(saleStage({ ...window, phaseOrder: 1 }, new Date("2026-10-10T00:00:00Z"))).toBe("Preventa · Fase 1");
  });

  it("sin descuento ni fase es venta", () => {
    expect(saleStage(none, new Date())).toBe("Venta");
  });
});
