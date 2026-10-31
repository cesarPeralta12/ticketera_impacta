import { describe, expect, it } from "vitest";
import { orderTotals } from "./checkout";
import { consumptionBreakdown, extraOptionsText, parseExtraOptions } from "./nightlife";

describe("parseExtraOptions", () => {
  it("convierte los paquetes a centavos, de menor a mayor y sin repetir", () => {
    expect(parseExtraOptions("500, 100, 200, 100")).toEqual({ ok: true, options: [10000, 20000, 50000] });
    expect(parseExtraOptions("150,50 200")).toEqual({ ok: true, options: [15050, 20000] });
  });

  it("vacío significa que no se vende extra", () => {
    expect(parseExtraOptions("  ")).toEqual({ ok: true, options: [] });
  });

  it("rechaza montos que no son números positivos", () => {
    expect(parseExtraOptions("100, abc").ok).toBe(false);
    expect(parseExtraOptions("0").ok).toBe(false);
    expect(parseExtraOptions("-50").ok).toBe(false);
  });

  it("limita la cantidad de paquetes", () => {
    expect(parseExtraOptions("1 2 3 4 5 6 7").ok).toBe(false);
    expect(parseExtraOptions("1 2 3 4 5 6").ok).toBe(true);
  });

  it("el texto del formulario vuelve a leerse igual", () => {
    expect(extraOptionsText([10000, 15050, 20000])).toBe("100, 150,5, 200");
    const again = parseExtraOptions(extraOptionsText([10000, 15050, 20000]));
    expect(again).toEqual({ ok: true, options: [10000, 15050, 20000] });
  });
});

describe("consumo extra en el total de la orden", () => {
  it("una mesa de Bs 1.500 con extra de Bs 300 cobra Bs 1.800 y el QR lleva el total del consumo", () => {
    const totals = orderTotals([{ unitAmount: 150000, quantity: 1, extraConsumption: 30000 }]);
    expect(totals.totalAmount).toBe(180000);
    expect(consumptionBreakdown(120000, 30000)).toEqual({ amount: 150000, included: 120000, extra: 30000 });
  });

  it("el extra va por unidad y los descuentos solo bajan el precio, no el extra", () => {
    const totals = orderTotals([{ unitAmount: 6500, quantity: 2, extraConsumption: 2000 }], 1300);
    expect(totals.subtotalAmount).toBe(17000);
    expect(totals.totalAmount).toBe(15700);
  });

  it("sin extra, el total es el de siempre", () => {
    expect(orderTotals([{ unitAmount: 5000, quantity: 3 }]).totalAmount).toBe(15000);
  });
});
