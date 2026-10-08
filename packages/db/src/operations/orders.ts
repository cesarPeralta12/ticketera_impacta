import { RESERVATION_MINUTES, checkoutSchema, currentPrice, findShortage, orderTotals, randomCode, remainingByType, type CheckoutInput } from "@ticketera/core";
import { prisma } from "../client";
import type { OrderChannel } from "../generated/prisma/client";
import { completeTurn, hasActiveTurn } from "./queue";
import { DomainError, findTakenSeats, loadInventory, lockInventory } from "./shared";

/** Cuántas entradas quedan de cada tipo en una función (sin bloquear: solo para mostrar). */
export async function getSessionAvailability(sessionId: string, now = new Date()) {
  return remainingByType(await loadInventory(prisma, sessionId, now));
}

/** Butacas vendidas o reservadas en una función, para pintar el mapa (solo para mostrar). */
export async function getTakenSeatIds(sessionId: string, now = new Date()) {
  const items = await prisma.orderItem.findMany({
    where: {
      seatId: { not: null },
      ticketType: { sessionId },
      order: {
        OR: [
          { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
          { status: "PENDING_PAYMENT", expiresAt: { gt: now } },
        ],
      },
    },
    select: { seatId: true },
  });
  return new Set(items.map((i) => i.seatId!));
}

/** Horas que la boletería sigue vendiendo después del inicio si la función no tiene hora de fin. */
export const BOX_OFFICE_HOURS_AFTER_START = 4;

/**
 * Hasta cuándo se vende una función: online, hasta que empieza; en boletería, también
 * durante el evento (en puerta), hasta que termina.
 */
export function salesCutoff(session: { startsAt: Date; endsAt: Date | null }, channel: OrderChannel) {
  if (channel !== "POS") return session.startsAt;
  return session.endsAt ?? new Date(session.startsAt.getTime() + BOX_OFFICE_HOURS_AFTER_START * 60 * 60_000);
}

/**
 * Crea una orden PENDING_PAYMENT, que es la reserva temporal del inventario.
 *
 * Todo ocurre en una transacción que bloquea los tipos de entrada y sus secciones:
 * si cien personas compran la última entrada (o la misma butaca) al mismo tiempo,
 * se atienden en fila y solo la primera la obtiene.
 *
 * Si la función tiene cola virtual, exige un turno vigente (queueToken) y lo da por
 * terminado al crear la orden, para que pase el siguiente de la fila. La boletería
 * (canal POS) no pasa por la cola: atiende a quien está en la fila física.
 */
export async function createPendingOrder(
  input: CheckoutInput,
  options: {
    now?: Date;
    queueToken?: string;
    customerId?: string;
    channel?: OrderChannel;
    issuedById?: string;
  } = {},
) {
  const now = options.now ?? new Date();
  const channel = options.channel ?? "ONLINE";
  const data = checkoutSchema.parse(input);
  const ids = data.items.map((i) => i.ticketTypeId);

  // Comprar online exige cuenta con carnet. Los datos del comprador salen SIEMPRE de la cuenta,
  // nunca de lo que mande el formulario: nadie puede comprar a nombre de otro ni sin identificarse.
  // (En boletería el cajero ingresa el carnet del cliente; las invitaciones no pasan por aquí.)
  if (channel === "ONLINE") {
    if (!options.customerId) throw new DomainError("LOGIN_REQUIRED", "Inicia sesión para comprar tus entradas.");
    const customer = await prisma.customer.findUnique({
      where: { id: options.customerId },
      select: { name: true, email: true, documentId: true, emailVerified: true },
    });
    if (!customer) throw new DomainError("LOGIN_REQUIRED", "Inicia sesión para comprar tus entradas.");
    if (!customer.documentId) {
      throw new DomainError("DOCUMENT_REQUIRED", "Completa tu carnet de identidad en tu cuenta para poder comprar.");
    }
    // Las entradas se envían a este correo: tiene que estar confirmado.
    if (!customer.emailVerified) {
      throw new DomainError("EMAIL_NOT_VERIFIED", "Confirma tu correo para poder comprar: te enviamos un enlace.");
    }
    data.buyer = { name: customer.name, email: customer.email, document: customer.documentId };
  }

  return prisma.$transaction(async (tx) => {
    const session = await tx.eventSession.findUnique({
      where: { id: data.sessionId },
      select: { queueEnabled: true },
    });
    if (
      channel === "ONLINE" &&
      session?.queueEnabled &&
      !(await hasActiveTurn(tx, data.sessionId, options.queueToken, now))
    ) {
      throw new DomainError("QUEUE_REQUIRED", "Tu turno en la fila virtual no está vigente. Vuelve a la fila.");
    }

    await lockInventory(tx, ids);

    const types = await tx.ticketType.findMany({
      where: { id: { in: ids } },
      include: {
        section: true,
        session: { include: { event: { include: { organization: { select: { status: true } } } } } },
      },
    });
    if (types.length !== ids.length) {
      throw new DomainError("INVALID_ITEMS", "Alguna de las entradas elegidas ya no existe.");
    }

    const byId = new Map(types.map((t) => [t.id, t]));
    for (const item of data.items) {
      const type = byId.get(item.ticketTypeId)!;
      const { session } = type;
      if (type.sessionId !== data.sessionId) {
        throw new DomainError("INVALID_ITEMS", "Las entradas deben ser de una misma función.");
      }
      if (session.cancelledAt || session.event.status !== "PUBLISHED" || salesCutoff(session, channel) <= now) {
        throw new DomainError("NOT_ON_SALE", "Esta función no está a la venta.");
      }
      if (session.event.organization.status !== "ACTIVE") {
        throw new DomainError("NOT_ON_SALE", "Este evento no está a la venta.");
      }
      if (session.event.mode === "GUEST_LIST") {
        throw new DomainError("NOT_ON_SALE", "Este evento es solo con lista de invitados: no tiene venta.");
      }
      const opens = [type.salesStartAt, session.salesStartAt].filter((d): d is Date => d !== null);
      const closes = [type.salesEndAt, session.salesEndAt].filter((d): d is Date => d !== null);
      if (opens.some((d) => d > now) || closes.some((d) => d <= now)) {
        throw new DomainError("NOT_ON_SALE", `La venta de "${type.name}" no está abierta.`);
      }
      const seated = type.section?.seatingMode === "RESERVED";
      if (seated !== Boolean(item.seatIds)) {
        throw new DomainError(
          "INVALID_ITEMS",
          seated ? `Elige tus butacas para "${type.name}" en el mapa.` : `"${type.name}" no tiene butacas numeradas.`,
        );
      }
      if (item.quantity > type.maxPerOrder) {
        throw new DomainError("INVALID_ITEMS", `Máximo ${type.maxPerOrder} entradas "${type.name}" por compra.`);
      }
    }

    const currencies = new Set(types.map((t) => t.currency));
    if (currencies.size !== 1) {
      throw new DomainError("INVALID_ITEMS", "Las entradas tienen monedas distintas.");
    }

    const seatIds = data.items.flatMap((i) => i.seatIds ?? []);
    if (seatIds.length > 0) {
      const seats = await tx.seat.findMany({ where: { id: { in: seatIds } }, select: { id: true, sectionId: true } });
      const sectionOf = new Map(seats.map((s) => [s.id, s.sectionId]));
      for (const item of data.items) {
        const sectionId = byId.get(item.ticketTypeId)!.sectionId;
        if (item.seatIds?.some((id) => sectionOf.get(id) !== sectionId)) {
          throw new DomainError("INVALID_ITEMS", "Alguna butaca no corresponde a la sección elegida.");
        }
      }
      const taken = await findTakenSeats(tx, data.sessionId, seatIds, now);
      if (taken.length > 0) {
        throw new DomainError(
          "SEAT_TAKEN",
          taken.length === 1
            ? "Una de tus butacas acaba de ser tomada por otra persona. Elige otra."
            : `${taken.length} de tus butacas acaban de ser tomadas por otras personas. Elige otras.`,
        );
      }
    }

    const shortage = findShortage(await loadInventory(tx, data.sessionId, now), data.items);
    if (shortage) {
      throw new DomainError(
        "SOLD_OUT",
        shortage.available === 0
          ? `"${shortage.name}" está agotada.`
          : `Solo quedan ${shortage.available} entradas "${shortage.name}".`,
      );
    }

    // Entrada general: una línea por tipo. Butacas: una línea por butaca.
    const priced = data.items.flatMap((item) => {
      const type = byId.get(item.ticketTypeId)!;
      // El precio lo decide el servidor al crear la orden (descuento de preventa vigente, si hay).
      const line = { ticketTypeId: type.id, unitAmount: currentPrice(type, now).unitAmount, name: type.name };
      return item.seatIds
        ? item.seatIds.map((seatId) => ({ ...line, quantity: 1, seatId }))
        : [{ ...line, quantity: item.quantity }];
    });

    if (options.queueToken) await completeTurn(tx, data.sessionId, options.queueToken, now);

    return tx.order.create({
      data: {
        code: randomCode(),
        channel,
        issuedById: options.issuedById,
        customerId: options.customerId,
        buyerName: data.buyer.name,
        buyerEmail: data.buyer.email,
        buyerDocument: data.buyer.document,
        status: "PENDING_PAYMENT",
        currency: [...currencies][0]!,
        ...orderTotals(priced),
        expiresAt: new Date(now.getTime() + RESERVATION_MINUTES * 60_000),
        items: { create: priced },
      },
    });
  });
}

/**
 * Marca como EXPIRED las órdenes pendientes cuya reserva venció. No es necesario para que
 * el inventario sea correcto (las reservas vencidas ya no cuentan), solo ordena los datos.
 * Si después llega un pago aprobado de una de ellas, se resuelve como pago tardío.
 */
export async function expireStaleOrders(now = new Date()) {
  const { count } = await prisma.order.updateMany({
    where: { status: "PENDING_PAYMENT", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  return count;
}

export async function getOrderByCode(code: string) {
  return prisma.order.findUnique({
    where: { code },
    include: {
      items: {
        include: {
          ticketType: { include: { session: { include: { event: true, venue: true } }, section: true } },
          seat: true,
        },
      },
      payments: { orderBy: { createdAt: "desc" } },
      tickets: { include: { ticketType: true, seat: { include: { section: true } } }, orderBy: { issuedAt: "asc" } },
    },
  });
}
