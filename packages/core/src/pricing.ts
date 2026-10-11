import { formatDateTime } from "./locale";

/**
 * Precio vigente de un tipo de entrada. Un tipo puede tener un descuento de preventa: durante su
 * ventana se cobra el precio de lista menos un porcentaje; fuera de ella, el precio normal.
 * El servidor calcula siempre el precio al crear la orden: el que muestra la web es informativo.
 */
export type DiscountWindow = {
  discountPercent: number | null;
  discountStartsAt: Date | null;
  discountEndsAt: Date | null;
};

export type CurrentPrice = {
  /** Lo que se cobra ahora. */
  unitAmount: number;
  /** Precio de lista (sin descuento). */
  listAmount: number;
  /** Porcentaje aplicado ahora, o null si no hay descuento vigente. */
  discountPercent: number | null;
  /** Hasta cuándo dura el descuento vigente. */
  discountEndsAt: Date | null;
};

export const MAX_DISCOUNT_PERCENT = 90;

export function discountActive(w: DiscountWindow, now: Date = new Date()): boolean {
  if (!w.discountPercent || w.discountPercent <= 0 || !w.discountEndsAt) return false;
  if (w.discountStartsAt && w.discountStartsAt > now) return false;
  return w.discountEndsAt > now;
}

/** Precio con el porcentaje descontado, en centavos enteros (redondeo al más cercano). */
export function discountedAmount(listAmount: number, percent: number): number {
  return Math.round((listAmount * (100 - percent)) / 100);
}

export function currentPrice(type: { unitAmount: number } & DiscountWindow, now: Date = new Date()): CurrentPrice {
  if (!discountActive(type, now)) {
    return { unitAmount: type.unitAmount, listAmount: type.unitAmount, discountPercent: null, discountEndsAt: null };
  }
  return {
    unitAmount: discountedAmount(type.unitAmount, type.discountPercent!),
    listAmount: type.unitAmount,
    discountPercent: type.discountPercent,
    discountEndsAt: type.discountEndsAt,
  };
}

/** Texto para mostrar: "20% menos hasta 20 oct, 23:59" (hora del recinto), o null si no hay descuento vigente. */
export function discountLabel(type: DiscountWindow, now: Date, timeZone: string): string | null {
  if (!discountActive(type, now)) return null;
  return `${type.discountPercent}% menos hasta ${formatDateTime(type.discountEndsAt!, timeZone)}`;
}
