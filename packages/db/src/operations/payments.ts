import {
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  TICKET_TRANSITIONS,
  assertTransition,
  findShortage,
  peopleIn,
  randomCode,
  type PaymentStatus,
} from "@ticketera/core";
import { prisma } from "../client";
import type { Prisma } from "../generated/prisma/client";
import {
  DomainError,
  audit,
  findTakenSeats,
  isUniqueViolation,
  loadInventory,
  lockInventory,
  type Tx,
} from "./shared";

/** Abre un intento de pago para una orden pendiente y vigente. */
export async function startPayment(orderCode: string, provider: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const order = await lockOrderByCode(tx, orderCode);
    if (order.status !== "PENDING_PAYMENT") {
      throw new DomainError("ORDER_NOT_PAYABLE", "Esta orden ya no se puede pagar.");
    }
    if (order.expiresAt <= now) {
      throw new DomainError("ORDER_EXPIRED", "La reserva venció. Vuelve a elegir tus entradas.");
    }
    return tx.payment.create({
      data: {
        orderId: order.id,
        provider,
        status: "PENDING",
        amount: order.totalAmount,
        currency: order.currency,
      },
    });
  });
}

export type PaymentUpdate = {
  paymentId: string;
  provider: string;
  providerPaymentId: string;
  status: PaymentStatus;
  providerStatus: string;
  amount: number;
  currency: string;
};

export type PaymentOutcome =
  | "DUPLICATE"
  | "PAID"
  | "REFUND_REQUIRED"
  | "REFUNDED"
  | "NOT_APPROVED";

/**
 * Aplica un cambio de estado informado por la pasarela (ya verificado por el webhook).
 * Es idempotente: si llega dos veces la misma notificación, la segunda no hace nada.
 *
 * Casos borde que resuelve:
 *  - Pago aprobado con la reserva vencida: se intenta volver a reservar; si ya no hay
 *    stock, la orden queda EXPIRED y el pago se marca para reembolso.
 *  - Segundo pago aprobado para una orden ya pagada: se marca para reembolso.
 *  - Monto o moneda distintos a los de la orden: se rechaza (posible manipulación).
 */
export async function applyPaymentUpdate(update: PaymentUpdate, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${update.paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { id: update.paymentId } });
    if (!payment || payment.provider !== update.provider) {
      throw new DomainError("PAYMENT_NOT_FOUND", `Pago ${update.paymentId} no encontrado.`);
    }
    if (payment.amount !== update.amount || payment.currency !== update.currency) {
      throw new DomainError(
        "PAYMENT_MISMATCH",
        `Monto informado ${update.amount} ${update.currency} no coincide con ${payment.amount} ${payment.currency}.`,
      );
    }

    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${payment.orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      include: {
        items: {
          include: { ticketType: { select: { sessionId: true, kind: true, peoplePerUnit: true, consumptionAmount: true, currency: true } } },
        },
      },
    });

    if (payment.status === update.status) return { outcome: "DUPLICATE" as PaymentOutcome, orderCode: order.code };

    assertTransition("pago", PAYMENT_TRANSITIONS, payment.status, update.status);
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: update.status,
        providerStatus: update.providerStatus,
        providerPaymentId: update.providerPaymentId,
        approvedAt: update.status === "APPROVED" ? now : undefined,
      },
    });
    await audit(tx, {
      actorType: "system",
      action: `payment.${update.status.toLowerCase()}`,
      entity: "Payment",
      entityId: payment.id,
      data: { orderCode: order.code, providerPaymentId: update.providerPaymentId },
    });

    const result = (outcome: PaymentOutcome) => ({ outcome, orderCode: order.code });

    if (update.status === "REFUNDED" || update.status === "CHARGED_BACK") {
      if (order.status === "PAID" || order.status === "PARTIALLY_REFUNDED") {
        await refundOrder(tx, order.id, order.status, update.status);
      }
      return result("REFUNDED");
    }
    if (update.status !== "APPROVED") return result("NOT_APPROVED");

    // ── Pago aprobado ──
    if (order.status !== "PENDING_PAYMENT" && order.status !== "EXPIRED") {
      await audit(tx, {
        actorType: "system",
        action: "payment.refund_required",
        entity: "Payment",
        entityId: payment.id,
        data: { reason: "order_not_payable", orderStatus: order.status, orderCode: order.code },
      });
      return result("REFUND_REQUIRED");
    }

    const holdIsValid = order.status === "PENDING_PAYMENT" && order.expiresAt > now;
    if (!holdIsValid) {
      const requested = order.items.map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity }));
      await lockInventory(tx, requested.map((r) => r.ticketTypeId));
      const sessionId = order.items[0]!.ticketType.sessionId;
      const shortage = findShortage(await loadInventory(tx, sessionId, now, order.id), requested);
      const seatIds = order.items.flatMap((i) => (i.seatId ? [i.seatId] : []));
      const seatTaken = (await findTakenSeats(tx, sessionId, seatIds, now, order.id)).length > 0;
      if (shortage || seatTaken) {
        if (order.status === "PENDING_PAYMENT") {
          await tx.order.update({ where: { id: order.id }, data: { status: "EXPIRED" } });
        }
        await audit(tx, {
          actorType: "system",
          action: "payment.refund_required",
          entity: "Payment",
          entityId: payment.id,
          data: { reason: "late_payment_sold_out", orderCode: order.code },
        });
        return result("REFUND_REQUIRED");
      }
    }

    assertTransition("orden", ORDER_TRANSITIONS, order.status, "PAID");
    await tx.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: now } });
    await issueTickets(tx, order);
    await audit(tx, {
      actorType: "system",
      action: holdIsValid ? "order.paid" : "order.paid_late",
      entity: "Order",
      entityId: order.id,
      data: { orderCode: order.code },
    });
    return result("PAID");
  });
}

export type PaidOrder = {
  id: string;
  customerId: string | null;
  buyerName: string;
  items: {
    id: string;
    ticketTypeId: string;
    seatId: string | null;
    quantity: number;
    ticketType: { sessionId: string; kind: "ENTRY" | "TABLE"; peoplePerUnit: number; consumptionAmount: number | null; currency: string };
  }[];
};

/**
 * Emite las entradas de una orden pagada. Una mesa emite un QR por persona, recibe su número (Mesa 1, 2…)
 * y abre un saldo de consumo que comparten sus personas; una entrada con consumo incluido abre un saldo
 * propio. Las mesas se numeran con su tipo de entrada bloqueado: dos pagos a la vez no repiten número.
 * `tableNumbers`: número de mesa ya decidido por línea (al importar una planilla que dice "Mesa 7").
 */
export async function issueTickets(tx: Tx, order: PaidOrder, tableNumbers?: Map<string, number>) {
  const tableTypes = [...new Set(order.items.filter((i) => i.ticketType.kind === "TABLE").map((i) => i.ticketTypeId))];
  if (tableTypes.length > 0) await lockInventory(tx, tableTypes);

  const rows: Prisma.TicketCreateManyInput[] = [];
  for (const item of order.items) {
    const type = item.ticketType;
    const ticket = (creditId: string | null = null) => ({
      code: randomCode(),
      orderId: order.id,
      orderItemId: item.id,
      ticketTypeId: item.ticketTypeId,
      sessionId: type.sessionId,
      seatId: item.seatId,
      customerId: order.customerId,
      holderName: order.buyerName,
      creditId,
    });
    const credit = (tableNumber: number | null) =>
      tx.consumptionCredit.create({
        data: {
          sessionId: type.sessionId,
          orderId: order.id,
          ticketTypeId: item.ticketTypeId,
          tableNumber,
          amount: type.consumptionAmount ?? 0,
          currency: type.currency,
        },
      });

    if (type.kind === "TABLE" && item.seatId) {
      // Mesa elegida en el mapa: el saldo guarda su lugar. Solo la primera entrada lleva la butaca (una butaca
      // tiene una sola entrada vigente: es la barrera contra la doble venta); las demás comparten la mesa.
      const table = await tx.consumptionCredit.create({
        data: {
          sessionId: type.sessionId,
          orderId: order.id,
          ticketTypeId: item.ticketTypeId,
          seatId: item.seatId,
          amount: type.consumptionAmount ?? 0,
          currency: type.currency,
        },
      });
      for (let person = 0; person < peopleIn(type); person++) {
        rows.push({ ...ticket(table.id), seatId: person === 0 ? item.seatId : null });
      }
    } else if (type.kind === "TABLE" && tableNumbers?.has(item.id)) {
      const table = await credit(tableNumbers.get(item.id)!);
      for (let person = 0; person < peopleIn(type); person++) rows.push(ticket(table.id));
    } else if (type.kind === "TABLE") {
      const last = await tx.consumptionCredit.aggregate({ where: { ticketTypeId: item.ticketTypeId }, _max: { tableNumber: true } });
      let next = (last._max.tableNumber ?? 0) + 1;
      for (let unit = 0; unit < item.quantity; unit++) {
        const table = await credit(next++);
        for (let person = 0; person < peopleIn(type); person++) rows.push(ticket(table.id));
      }
    } else if (type.consumptionAmount) {
      for (let unit = 0; unit < item.quantity; unit++) rows.push(ticket((await credit(null)).id));
    } else {
      for (let unit = 0; unit < item.quantity; unit++) rows.push(ticket());
    }
  }
  await tx.ticket.createMany({ data: rows });
}

async function refundOrder(
  tx: Tx,
  orderId: string,
  from: "PAID" | "PARTIALLY_REFUNDED",
  reason: PaymentStatus,
) {
  assertTransition("orden", ORDER_TRANSITIONS, from, "REFUNDED");
  await tx.order.update({ where: { id: orderId }, data: { status: "REFUNDED" } });
  assertTransition("entrada", TICKET_TRANSITIONS, "VALID", "CANCELLED");
  // Las entradas ya usadas quedan como USED: el historial de acceso no se reescribe.
  await tx.ticket.updateMany({
    where: { orderId, status: "VALID" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  await audit(tx, {
    actorType: "system",
    action: "order.refunded",
    entity: "Order",
    entityId: orderId,
    data: { reason },
  });
}

async function lockOrderByCode(tx: Tx, code: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Order" WHERE code = ${code} FOR UPDATE`;
  const id = rows[0]?.id;
  if (!id) throw new DomainError("ORDER_NOT_FOUND", "Orden no encontrada.");
  return tx.order.findUniqueOrThrow({ where: { id } });
}

/**
 * Registra el webhook crudo antes de procesarlo. Si la pasarela lo reenvía:
 *  - ya procesado -> se ignora (idempotencia);
 *  - registrado pero falló al procesar -> se vuelve a intentar.
 */
export async function recordWebhookEvent(event: {
  provider: string;
  externalId: string;
  topic?: string;
  payload: Prisma.InputJsonValue;
}) {
  try {
    return { event: await prisma.webhookEvent.create({ data: event }), alreadyProcessed: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.webhookEvent.findUniqueOrThrow({
      where: { provider_externalId: { provider: event.provider, externalId: event.externalId } },
    });
    return { event: existing, alreadyProcessed: existing.processedAt !== null };
  }
}

export async function markWebhookProcessed(id: string, error?: string) {
  await prisma.webhookEvent.update({
    where: { id },
    data: error ? { error } : { processedAt: new Date(), error: null },
  });
}
