/**
 * Promotores (RRPP): venden con cobro por QR los eventos que tienen asignados y ganan una comisión por cada venta
 * pagada, la que hacen ellos y la que se compra en la web con su código. Cálculo puro, sin base de datos.
 */
import { randomCode } from "./codes";

export type CommissionType = "PERCENT" | "FIXED";

export type CommissionRule = {
  commissionType: CommissionType;
  /** PERCENT: 1 a 100. FIXED: centavos por entrada (o mesa) vendida. */
  commissionValue: number;
};

/** Hasta Bs 10.000 por entrada: frena un error de tipeo (un cero de más). */
export const MAX_FIXED_COMMISSION = 1_000_000;

/**
 * Comisión de una venta (centavos): el porcentaje sobre lo que pagó el cliente (ya con descuentos), o el monto fijo
 * por cada entrada o mesa vendida.
 */
export function commissionFor(rule: CommissionRule, sale: { totalAmount: number; units: number }): number {
  if (rule.commissionType === "PERCENT") return Math.round((sale.totalAmount * Math.min(100, Math.max(0, rule.commissionValue))) / 100);
  return Math.max(0, rule.commissionValue) * sale.units;
}

/** "10% de cada venta" o "Bs 10,00 por entrada". */
export function commissionLabel(rule: CommissionRule, formatAmount: (centavos: number) => string): string {
  return rule.commissionType === "PERCENT" ? `${rule.commissionValue}% de cada venta` : `${formatAmount(rule.commissionValue)} por entrada`;
}

/** El código personal del promotor para la web, con su nombre: "RP-JUAN-K7Q3M". */
export function promoterCode(name: string): string {
  const first = (name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().split(/\s+/)[0] ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase();
  return first ? `RP-${first}-${randomCode(5)}` : `RP-${randomCode(5)}`;
}
