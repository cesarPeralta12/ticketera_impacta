/**
 * Qué se puede descargar como imagen y cuándo una función ya pasó. Una imagen es estática: solo sirve lo que se lee
 * igual cada vez (QR fijo o código de barras). Un QR dinámico cambia cada 30 segundos y el NFC no es una imagen.
 */

export type TicketImageInput = {
  status: string;
  qrMode: "STATIC" | "DYNAMIC";
  accessMethods: readonly string[];
  /** Ingresos que permite (1 = sin reingreso, 0 = sin límite). */
  maxEntries?: number | null;
  /** La entrada se transfirió a otra cuenta: su QR dejó de valer para quien la entregó. */
  transferredAway?: boolean;
};

/** ¿Se ofrece «Descargar como imagen» para esta entrada? */
export function canDownloadTicketImage(t: TicketImageInput): boolean {
  if (t.status !== "VALID" && t.status !== "USED") return false;
  if (t.transferredAway) return false;
  if (t.qrMode === "DYNAMIC") return false;
  if (!t.accessMethods.includes("QR") && !t.accessMethods.includes("BARCODE")) return false;
  // Ya ingresó y no puede volver a entrar: la imagen ya no sirve para nada.
  if (t.status === "USED" && t.maxEntries === 1) return false;
  return true;
}

export type VoucherImageInput = { amount: number; redeemedAt: Date | null; cancelled: boolean };

/** ¿Se ofrece «Descargar como imagen» para este QR de consumo? Solo mientras no se haya leído ni anulado. */
export function canDownloadVoucherImage(v: VoucherImageInput): boolean {
  return v.amount > 0 && v.redeemedAt === null && !v.cancelled;
}

/** Cuánto sigue vigente una función sin hora de fin: las noches duran hasta la madrugada. */
export const NIGHT_HOURS = 12;
/** Margen después de la hora de fin: la gente sale y vuelve a entrar. */
export const NIGHT_GRACE_HOURS = 3;

/** Hasta cuándo se muestran los QR de una función en «Mis entradas»; después pasa al historial. */
export function nightEndsAt(startsAt: Date, endsAt?: Date | null): Date {
  const hour = 60 * 60_000;
  return endsAt ? new Date(endsAt.getTime() + NIGHT_GRACE_HOURS * hour) : new Date(startsAt.getTime() + NIGHT_HOURS * hour);
}

export const isPastNight = (startsAt: Date, endsAt: Date | null | undefined, now: Date) => now.getTime() > nightEndsAt(startsAt, endsAt).getTime();
