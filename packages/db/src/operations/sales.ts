/**
 * Ventas fuera del marketplace: boletería (POS) e invitaciones/cortesías. Todas descuentan
 * del mismo inventario que la venta online y generan entradas con QR iguales.
 */
import {
  ORDER_TRANSITIONS,
  TICKET_TRANSITIONS,
  assertTransition,
  findShortage,
  randomCode,
  type CheckoutInput,
} from "@ticketera/core";
import { prisma } from "../client";
import { createPendingOrder } from "./orders";
import { applyPaymentUpdate, startPayment } from "./payments";
import { DomainError, audit, loadInventory, lockInventory } from "./shared";

export const POS_METHODS = ["EFECTIVO", "QR", "TARJETA"] as const;
export type PosMethod = (typeof POS_METHODS)[number];

export const POS_METHOD_LABEL: Record<PosMethod, string> = {
  EFECTIVO: "Efectivo",
  QR: "QR",
  TARJETA: "Tarjeta",
};

/** El medio de pago de boletería se guarda en Payment.provider ("pos_efectivo", ...). */
export const posProvider = (method: PosMethod) => `pos_${method.toLowerCase()}`;

/** Comprador por defecto de boletería: en caja no es obligatorio pedir nombre ni email. */
export const BOX_OFFICE_BUYER = { name: "Venta en boletería", email: "sin-email@boleteria.invalid" };

/**
 * Venta en boletería: reserva atómica (igual que online), registra el cobro en caja como
 * pago aprobado y emite las entradas en el acto. No pasa por la cola virtual.
 * El cobro no se conecta a ningún banco: el cajero declara el medio.
 */
export async function sellAtBoxOffice(
  input: CheckoutInput,
  options: { staffId: string; method: PosMethod; now?: Date; promoCode?: string },
) {
  const buyer = {
    ...input.buyer,
    name: input.buyer.name.trim() || BOX_OFFICE_BUYER.name,
    email: input.buyer.email.trim() || BOX_OFFICE_BUYER.email,
  };
  const order = await createPendingOrder({ ...input, buyer }, {
    channel: "POS",
    issuedById: options.staffId,
    now: options.now,
    promoCode: options.promoCode,
  });
  const provider = posProvider(options.method);
  const payment = await startPayment(order.code, provider, options.now);
  await applyPaymentUpdate(
    {
      paymentId: payment.id,
      provider,
      providerPaymentId: `caja_${payment.id}`,
      status: "APPROVED",
      providerStatus: "cobrado_en_caja",
      amount: payment.amount,
      currency: payment.currency,
    },
    options.now,
  );
  return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
}

export type GuestInput = { name: string; email?: string; document?: string };

/**
 * Emite una invitación (entrada sin cobro) por persona. Respeta el cupo del tipo de entrada
 * y el aforo de su sección: una cortesía ocupa un lugar igual que una entrada vendida.
 * Solo para entradas generales: las invitaciones no eligen butaca.
 */
export async function issueGuestTickets(input: {
  ticketTypeId: string;
  guests: GuestInput[];
  staffId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const guests = input.guests
    .map((g) => ({ name: g.name.trim(), email: g.email?.trim().toLowerCase() || "", document: g.document?.trim() || null }))
    .filter((g) => g.name.length > 0);
  if (guests.length === 0) throw new DomainError("INVALID_ITEMS", "La lista no tiene invitados con nombre.");
  if (guests.length > 2000) throw new DomainError("INVALID_ITEMS", "Máximo 2.000 invitados por carga.");

  return prisma.$transaction(
    async (tx) => {
      await lockInventory(tx, [input.ticketTypeId]);
      const type = await tx.ticketType.findUnique({
        where: { id: input.ticketTypeId },
        include: { section: true, session: { include: { event: true } } },
      });
      if (!type) throw new DomainError("INVALID_ITEMS", "Tipo de entrada no encontrado.");
      if (type.session.cancelledAt || type.session.event.status === "CANCELLED") {
        throw new DomainError("NOT_ON_SALE", "La función está cancelada.");
      }
      if (type.section?.seatingMode === "RESERVED") {
        throw new DomainError("INVALID_ITEMS", "Las invitaciones son para entradas generales, no para butacas numeradas.");
      }

      const shortage = findShortage(await loadInventory(tx, type.sessionId, now), [
        { ticketTypeId: type.id, quantity: guests.length },
      ]);
      if (shortage) {
        throw new DomainError("SOLD_OUT", `Solo quedan ${shortage.available} lugares en "${type.name}".`);
      }

      const codes: string[] = [];
      for (const guest of guests) {
        const order = await tx.order.create({
          data: {
            code: randomCode(),
            channel: "GUEST",
            issuedById: input.staffId,
            buyerName: guest.name,
            buyerEmail: guest.email,
            buyerDocument: guest.document,
            status: "PAID",
            currency: type.currency,
            subtotalAmount: 0,
            feeAmount: 0,
            totalAmount: 0,
            expiresAt: now,
            paidAt: now,
            items: { create: { ticketTypeId: type.id, quantity: 1, unitAmount: 0, name: type.name } },
          },
          include: { items: true },
        });
        await tx.ticket.create({
          data: {
            code: randomCode(),
            orderId: order.id,
            orderItemId: order.items[0]!.id,
            ticketTypeId: type.id,
            sessionId: type.sessionId,
            holderName: guest.name,
          },
        });
        codes.push(order.code);
      }
      await audit(tx, {
        actorType: "staff",
        actorId: input.staffId,
        action: "guests.issue",
        entity: "TicketType",
        entityId: type.id,
        data: { count: guests.length },
      });
      return codes;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/**
 * Anula una invitación: la entrada deja de ser válida y libera su lugar. Las entradas ya
 * usadas no se anulan (la persona ya entró). Solo para invitaciones: anular una venta
 * implica devolver dinero y se hace como reembolso.
 */
export async function cancelGuestTicket(input: { ticketId: string; staffId: string; now?: Date }) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: input.ticketId }, include: { order: true } });
    if (!ticket) throw new DomainError("ORDER_NOT_FOUND", "Entrada no encontrada.");
    if (ticket.order.channel !== "GUEST") {
      throw new DomainError("ORDER_NOT_PAYABLE", "Solo se pueden anular invitaciones. Una venta se reembolsa.");
    }
    if (ticket.status === "USED") throw new DomainError("ORDER_NOT_PAYABLE", "Esta invitación ya fue usada en puerta.");
    if (ticket.status === "CANCELLED") return;

    assertTransition("entrada", TICKET_TRANSITIONS, ticket.status, "CANCELLED");
    await tx.ticket.update({ where: { id: ticket.id }, data: { status: "CANCELLED", cancelledAt: now } });
    assertTransition("orden", ORDER_TRANSITIONS, ticket.order.status, "CANCELLED");
    await tx.order.update({ where: { id: ticket.orderId }, data: { status: "CANCELLED" } });
    await audit(tx, {
      actorType: "staff",
      actorId: input.staffId,
      action: "guests.cancel",
      entity: "Ticket",
      entityId: ticket.id,
    });
  });
}
