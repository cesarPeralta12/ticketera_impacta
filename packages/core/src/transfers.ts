/**
 * Reglas para transferir una entrada a otra persona registrada. Puras (sin base de datos).
 *
 * La transferencia es una oferta que la otra persona acepta: al aceptarla, la entrada recibe un
 * código nuevo (el QR anterior deja de valer) y pasa a su cuenta, con su nombre y su carnet.
 */
export const MAX_TRANSFERS_PER_TICKET = 2;
/** No se transfiere en las últimas horas antes de la función: la puerta ya no alcanza a enterarse. */
export const TRANSFER_CUTOFF_HOURS = 2;
/** Cuánto tiempo tiene la otra persona para aceptar. */
export const TRANSFER_OFFER_HOURS = 72;
/** Pedidos de transferencia por hora y por cuenta (evita usarlo para buscar cuentas ajenas). */
export const MAX_TRANSFER_REQUESTS_PER_HOUR = 10;

export type TransferCheck = {
  status: "VALID" | "USED" | "CANCELLED";
  transferCount: number;
  startsAt: Date;
  eventTransfersEnabled: boolean;
  sessionCancelled: boolean;
  hasPendingTransfer: boolean;
  now: Date;
};

/** Por qué una entrada no se puede transferir ahora, o null si se puede. */
export function transferBlockReason(t: TransferCheck): string | null {
  if (t.status === "USED") return "Esta entrada ya se usó para ingresar.";
  if (t.status === "CANCELLED") return "Esta entrada fue anulada.";
  if (t.sessionCancelled) return "La función fue cancelada.";
  if (!t.eventTransfersEnabled) return "El organizador no permite transferir las entradas de este evento.";
  if (t.hasPendingTransfer) return "Ya la ofreciste a alguien: cancela esa oferta para ofrecerla a otra persona.";
  if (t.transferCount >= MAX_TRANSFERS_PER_TICKET) {
    return `Esta entrada ya se transfirió ${MAX_TRANSFERS_PER_TICKET} veces: no se puede transferir más.`;
  }
  if (t.now.getTime() >= transferDeadline(t.startsAt).getTime()) {
    return `Ya no se pueden transferir entradas: faltan menos de ${TRANSFER_CUTOFF_HOURS} horas para la función.`;
  }
  return null;
}

/** Hasta cuándo se puede ofrecer o aceptar una transferencia de una función. */
export function transferDeadline(startsAt: Date): Date {
  return new Date(startsAt.getTime() - TRANSFER_CUTOFF_HOURS * 3_600_000);
}

/** Vencimiento de una oferta: 72 h, o antes si la función está por empezar. */
export function offerExpiry(now: Date, startsAt: Date): Date {
  const byTime = now.getTime() + TRANSFER_OFFER_HOURS * 3_600_000;
  return new Date(Math.min(byTime, transferDeadline(startsAt).getTime()));
}
