/**
 * Dinero.
 *
 * Todos los montos del sistema son enteros en la unidad mínima de la moneda:
 * CLP en pesos (no tiene decimales); ARS, MXN y USD en centavos.
 * Nunca se usa float para dinero: 0.1 + 0.2 !== 0.3.
 */
import { LOCALE } from "./locale";

export function minorUnitDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

export function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`Monto inválido: ${amount}. Debe ser un entero >= 0 en unidad mínima.`);
  }
}

export function lineTotal(unitAmount: number, quantity: number): number {
  assertAmount(unitAmount);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError(`Cantidad inválida: ${quantity}`);
  }
  const total = unitAmount * quantity;
  assertAmount(total);
  return total;
}

export function formatMoney(amount: number, currency: string, locale: string = LOCALE): string {
  const digits = minorUnitDigits(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 10 ** digits);
}
