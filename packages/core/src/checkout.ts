/**
 * Reglas del checkout que no dependen de la base de datos.
 */
import { z } from "zod";
import { lineTotal } from "./money";

/**
 * Minutos que dura la reserva de entradas mientras el comprador paga.
 * Pendiente de confirmar con el cliente (decisión de Sprint 0).
 */
export const RESERVATION_MINUTES = 10;

/** Máximo absoluto de entradas por orden, sin importar el tipo. */
export const MAX_TICKETS_PER_ORDER = 10;

export const checkoutSchema = z.object({
  sessionId: z.string().min(1),
  items: z
    .array(
      z
        .object({
          ticketTypeId: z.string().min(1),
          quantity: z.number().int().min(1).max(MAX_TICKETS_PER_ORDER),
          /** Solo para secciones numeradas: las butacas elegidas en el mapa. */
          seatIds: z.array(z.string().min(1)).max(MAX_TICKETS_PER_ORDER).optional(),
        })
        .refine((item) => !item.seatIds || item.seatIds.length === item.quantity, {
          message: "La cantidad no coincide con las butacas elegidas.",
        })
        .refine((item) => !item.seatIds || new Set(item.seatIds).size === item.seatIds.length, {
          message: "Butaca repetida.",
        }),
    )
    .min(1, "Elige al menos una entrada.")
    .refine(
      (items) => items.reduce((sum, i) => sum + i.quantity, 0) <= MAX_TICKETS_PER_ORDER,
      `Máximo ${MAX_TICKETS_PER_ORDER} entradas por compra.`,
    )
    .refine(
      (items) => new Set(items.map((i) => i.ticketTypeId)).size === items.length,
      "Tipo de entrada repetido.",
    ),
  buyer: z.object({
    name: z.string().trim().min(3, "Ingresa tu nombre completo.").max(120),
    email: z.string().trim().toLowerCase().pipe(z.email("Ingresa un email válido.")),
    document: z
      .string()
      .trim()
      .max(20)
      .optional()
      .transform((v) => v || undefined),
  }),
});

/** Datos del checkout tal como llegan (antes de normalizar). */
export type CheckoutInput = z.input<typeof checkoutSchema>;

export type PricedItem = { unitAmount: number; quantity: number };

/**
 * Cargo por servicio. Pendiente de definir con el cliente (monto fijo, porcentaje,
 * quién lo paga): por ahora es 0.
 */
export function serviceFee(_subtotal: number): number {
  return 0;
}

export function orderTotals(items: PricedItem[]) {
  const subtotalAmount = items.reduce((sum, i) => sum + lineTotal(i.unitAmount, i.quantity), 0);
  const feeAmount = serviceFee(subtotalAmount);
  return { subtotalAmount, feeAmount, totalAmount: subtotalAmount + feeAmount };
}
