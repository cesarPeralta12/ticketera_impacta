/**
 * Códigos promocionales (cálculo puro, sin base de datos).
 *
 * Un código da un descuento sobre las entradas de una compra: un porcentaje, o un monto fijo por
 * entrada. Puede llevar el nombre de un promotor (RRPP) para saber cuánto vendió cada uno.
 * Por defecto NO se suma al descuento de preventa: el que ya tiene precio de preventa queda fuera
 * del código, salvo que el código se marque como combinable.
 */
import { randomCode } from "./codes";

export type PromoDiscountType = "PERCENT" | "FIXED";

export type PromoRule = {
  discountType: PromoDiscountType;
  /** PERCENT: 1 a 100. FIXED: centavos que se descuentan de cada entrada. */
  discountValue: number;
  combinableWithPresale: boolean;
};

export type PromoLine = {
  unitAmount: number;
  quantity: number;
  /** La entrada ya tiene un descuento de preventa vigente. */
  presaleDiscountActive: boolean;
};

/** Mayúsculas y sin espacios: "rrpp 20" y "RRPP20" son el mismo código. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** 3 a 24 caracteres: letras, números, guion o guion bajo. */
export function isValidPromoCode(code: string): boolean {
  return /^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(code);
}

/** Código legible y difícil de adivinar, por ejemplo "RRPP-K7Q3M". */
export function generatePromoCode(prefix = "IMPACTA"): string {
  const clean = normalizePromoCode(prefix).replace(/[^A-Z0-9]/g, "").slice(0, 12) || "IMPACTA";
  return `${clean}-${randomCode(5)}`;
}

/** Descuento total (en centavos) que da el código sobre las líneas de la compra. Nunca supera lo que se paga. */
export function promoDiscount(lines: PromoLine[], rule: PromoRule): number {
  let total = 0;
  for (const line of lines) {
    if (line.presaleDiscountActive && !rule.combinableWithPresale) continue;
    const lineAmount = line.unitAmount * line.quantity;
    total +=
      rule.discountType === "PERCENT"
        ? Math.round((lineAmount * Math.min(100, rule.discountValue)) / 100)
        : Math.min(rule.discountValue, line.unitAmount) * line.quantity;
  }
  return Math.min(total, lines.reduce((sum, l) => sum + l.unitAmount * l.quantity, 0));
}

/** Texto corto para mostrar: "20% menos" o "Bs 10,00 menos por entrada". */
export function promoLabel(rule: Pick<PromoRule, "discountType" | "discountValue">, formatAmount: (centavos: number) => string): string {
  return rule.discountType === "PERCENT"
    ? `${rule.discountValue}% menos`
    : `${formatAmount(rule.discountValue)} menos por entrada`;
}
