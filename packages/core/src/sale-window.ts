/**
 * Ventana de venta de un tipo de entrada: desde/hasta cuándo se vende. La preventa es un
 * tipo con fecha de fin; cuando termina, sigue el tipo general (que puede empezar justo ahí).
 */
export type SaleWindow = { salesStartAt: Date | null; salesEndAt: Date | null };

/** scheduled: todavía no empieza · open: a la venta · closed: ya terminó. */
export type SaleState = "scheduled" | "open" | "closed";

export function saleState(window: SaleWindow, now: Date = new Date()): SaleState {
  if (window.salesStartAt && window.salesStartAt > now) return "scheduled";
  if (window.salesEndAt && window.salesEndAt <= now) return "closed";
  return "open";
}

/**
 * ¿Se venden a la vez? Una sección numerada solo puede tener un precio a la vez: su
 * preventa y su general tienen que ser consecutivas, no superpuestas.
 */
export function windowsOverlap(a: SaleWindow, b: SaleWindow): boolean {
  const start = (w: SaleWindow) => w.salesStartAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const end = (w: SaleWindow) => w.salesEndAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return start(a) < end(b) && start(b) < end(a);
}
