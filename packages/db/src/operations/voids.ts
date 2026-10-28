/**
 * Anulaciones y devoluciones de ventas: solo las hace un administrador, siempre con motivo, y quedan en el registro
 * de seguridad. Las entradas dejan de valer y su lugar vuelve a la venta. No se anula lo que ya se usó (alguien entró
 * con esa entrada o gastó su consumo).
 *
 * - Anular: la venta no debió existir (error de caja, cobro que no llegó). Queda CANCELLED.
 * - Devolver: se le devolvió el dinero al comprador. Queda REFUNDED (con una pasarela conectada, el reembolso se hace
 *   además contra su API; hoy se registra que se devolvió por fuera).
 */
import { ORDER_TRANSITIONS, PAYMENT_TRANSITIONS, assertTransition } from "@ticketera/core";
import { prisma } from "../client";
import { DomainError, TX_OPTIONS, audit } from "./shared";

export async function voidOrder(
  input: { orderCode: string; organizationId: string | null; staffId: string; reason: string; refund: boolean },
  now = new Date(),
) {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError("INVALID_ITEMS", "Escribe el motivo (al menos unas palabras): queda en el registro.");
  return prisma.$transaction(async (tx) => {
    const found = await tx.order.findUnique({ where: { code: input.orderCode }, select: { id: true } });
    if (!found) throw new DomainError("ORDER_NOT_FOUND", "Venta no encontrada.");
    // La fila bloqueada: dos anulaciones a la vez (o una anulación y un pago tardío) no se pisan.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.id} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: found.id },
      include: {
        tickets: { select: { id: true, status: true, entries: true } },
        credits: { select: { spent: true } },
        payments: { where: { status: "APPROVED" }, select: { id: true, status: true } },
        items: { take: 1, select: { ticketType: { select: { session: { select: { event: { select: { organizationId: true } } } } } } } },
      },
    });
    const organizationId = order.items[0]?.ticketType.session.event.organizationId;
    if (input.organizationId && organizationId !== input.organizationId) throw new DomainError("ORDER_NOT_FOUND", "Venta no encontrada.");
    if (order.channel === "GUEST") throw new DomainError("INVALID_STATE", "Es una invitación: se anula desde Invitaciones.");
    if (order.channel === "PRINTED") throw new DomainError("INVALID_STATE", "Es una entrada impresa: se anula desde su lote de impresas.");
    if (order.status !== "PAID") throw new DomainError("INVALID_STATE", "Solo se anula o devuelve una venta pagada.");
    if (order.tickets.some((t) => t.status === "USED" || t.entries > 0)) {
      throw new DomainError("INVALID_STATE", "Alguna entrada de esta venta ya se usó en la puerta: no se puede anular.");
    }
    if (order.credits.some((c) => c.spent > 0)) throw new DomainError("INVALID_STATE", "Ya se gastó parte del consumo incluido en la barra: no se puede anular.");

    const status = input.refund ? ("REFUNDED" as const) : ("CANCELLED" as const);
    assertTransition("orden", ORDER_TRANSITIONS, order.status, status);
    await tx.ticket.updateMany({ where: { orderId: order.id, status: "VALID" }, data: { status: "CANCELLED", cancelledAt: now } });
    if (input.refund) {
      for (const payment of order.payments) {
        assertTransition("pago", PAYMENT_TRANSITIONS, payment.status, "REFUNDED");
        await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
      }
    }
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status, voidedAt: now, voidedById: input.staffId, voidReason: reason.slice(0, 500) },
    });
    await audit(tx, {
      actorType: "staff",
      actorId: input.staffId,
      action: input.refund ? "order.refund" : "order.void",
      entity: "Order",
      entityId: order.id,
      data: { code: order.code, reason, total: order.totalAmount, tickets: order.tickets.length, promoterId: order.promoterId, commissionPaid: Boolean(order.commissionPayoutId) },
      severity: "warn",
    });
    return updated;
  }, TX_OPTIONS);
}
