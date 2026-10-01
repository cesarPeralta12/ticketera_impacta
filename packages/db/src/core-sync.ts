/**
 * Verificación en tiempo de compilación: los enums del esquema Prisma deben ser
 * exactamente los estados que maneja @ticketera/core. Si alguien agrega un estado
 * en un lado y no en el otro, `npm run typecheck` falla aquí.
 */
import type * as Core from "@ticketera/core";
import type { OrderStatus, PaymentStatus, TicketStatus } from "./generated/prisma/enums";

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type OrderStatusInSync = Assert<Equals<OrderStatus, Core.OrderStatus>>;
export type PaymentStatusInSync = Assert<Equals<PaymentStatus, Core.PaymentStatus>>;
export type TicketStatusInSync = Assert<Equals<TicketStatus, Core.TicketStatus>>;
