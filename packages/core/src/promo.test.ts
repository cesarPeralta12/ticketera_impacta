import { describe, expect, it } from "vitest";
import { generatePromoCode, isValidPromoCode, normalizePromoCode, promoDiscount, promoLabel } from "./promo";

const line = (unitAmount: number, quantity: number, presaleDiscountActive = false) => ({ unitAmount, quantity, presaleDiscountActive });
const percent = (discountValue: number, combinableWithPresale = false) => ({ discountType: "PERCENT" as const, discountValue, combinableWithPresale });
const fixed = (discountValue: number, combinableWithPresale = false) => ({ discountType: "FIXED" as const, discountValue, combinableWithPresale });

describe("códigos promocionales", () => {
  it("normaliza y valida el código", () => {
    expect(normalizePromoCode("  rrpp 20 ")).toBe("RRPP20");
    expect(isValidPromoCode("RRPP20")).toBe(true);
    expect(isValidPromoCode("AB")).toBe(false);
    expect(isValidPromoCode("con espacio")).toBe(false);
    expect(isValidPromoCode("A".repeat(25))).toBe(false);
  });

  it("genera códigos legibles y válidos", () => {
    const code = generatePromoCode("rrpp luis");
    expect(code).toMatch(/^RRPPLUIS-[A-Z0-9]{5}$/);
    expect(isValidPromoCode(code)).toBe(true);
  });

  it("el porcentaje se aplica sobre cada línea y redondea al centavo", () => {
    expect(promoDiscount([line(10_000, 2)], percent(20))).toBe(4_000);
    expect(promoDiscount([line(9_999, 1), line(5_000, 3)], percent(15))).toBe(1_500 + 2_250); // 1499.85→1500
    expect(promoDiscount([line(10_000, 1)], percent(100))).toBe(10_000);
  });

  it("el monto fijo es por entrada y nunca deja una entrada en negativo", () => {
    expect(promoDiscount([line(10_000, 3)], fixed(1_500))).toBe(4_500);
    expect(promoDiscount([line(1_000, 2)], fixed(1_500))).toBe(2_000); // la entrada vale menos que el descuento
  });

  it("no se suma al descuento de preventa, salvo que el código sea combinable", () => {
    const lines = [line(7_000, 2, true), line(9_000, 1, false)];
    expect(promoDiscount(lines, percent(10))).toBe(900);
    expect(promoDiscount(lines, percent(10, true))).toBe(1_400 + 900);
    expect(promoDiscount([line(7_000, 2, true)], percent(10))).toBe(0);
  });

  it("describe el descuento", () => {
    const money = (c: number) => `Bs ${(c / 100).toFixed(2)}`;
    expect(promoLabel(percent(20), money)).toBe("20% menos");
    expect(promoLabel(fixed(1_000), money)).toBe("Bs 10.00 menos por entrada");
  });
});
