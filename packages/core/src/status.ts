/**
 * Máquinas de estado de orden, pago y entrada.
 *
 * Toda transición de estado en el sistema debe pasar por `assertTransition`.
 * Los valores deben coincidir con los enums del esquema Prisma
 * (packages/db/src/core-sync.ts lo verifica en tiempo de compilación).
 */

export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PAID",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "REFUNDED",
  "CHARGED_BACK",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TICKET_STATUSES = ["VALID", "USED", "CANCELLED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * Una orden PENDING_PAYMENT con `expiresAt` futuro es la reserva temporal de inventario.
 *
 * EXPIRED -> PAID cubre el caso borde clásico: el comprador paga cuando la reserva
 * ya venció. Solo se permite si se logra volver a reservar el inventario; si no,
 * la orden queda EXPIRED y el pago se reembolsa.
 */
export const ORDER_TRANSITIONS: TransitionMap<OrderStatus> = {
  PENDING_PAYMENT: ["PAID", "EXPIRED", "CANCELLED"],
  EXPIRED: ["PAID"],
  PAID: ["REFUNDED", "PARTIALLY_REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

/** Cada intento de pago es un Payment nuevo; un pago rechazado no se reintenta. */
export const PAYMENT_TRANSITIONS: TransitionMap<PaymentStatus> = {
  PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["REFUNDED", "CHARGED_BACK"],
  REJECTED: [],
  CANCELLED: [],
  REFUNDED: [],
  CHARGED_BACK: [],
};

export const TICKET_TRANSITIONS: TransitionMap<TicketStatus> = {
  VALID: ["USED", "CANCELLED"],
  USED: [],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Transición inválida de ${entity}: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition<S extends string>(map: TransitionMap<S>, from: S, to: S): boolean {
  return map[from].includes(to);
}

export function assertTransition<S extends string>(
  entity: string,
  map: TransitionMap<S>,
  from: S,
  to: S,
): void {
  if (!canTransition(map, from, to)) throw new InvalidTransitionError(entity, from, to);
}
