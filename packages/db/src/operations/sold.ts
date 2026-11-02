/**
 * Entradas vendidas de un evento y la historia de cada una: quién la compró, a quién pertenece ahora, cada transferencia,
 * en qué etapa se vendió (preventa, fase, venta) y a qué precio. Es para el panel; nada de aquí cambia datos.
 */
import { saleStage, type DiscountWindow } from "@ticketera/core";
import { prisma } from "../client";
import type { OrderChannel, Prisma, TicketStatus } from "../generated/prisma/client";

/** Etapa de una línea vendida y si es una estimación (lo vendido antes de guardarla se calcula con las fechas del tipo). */
export function soldStage(input: {
  saleStage: string | null;
  channel: OrderChannel;
  ticketType: DiscountWindow & { phaseOrder: number | null };
  orderedAt: Date;
}): { text: string; estimated: boolean } {
  if (input.saleStage) return { text: input.saleStage, estimated: false };
  // Lo cargado desde un archivo no pasó por la venta online: no tiene preventa ni fase.
  if (input.channel === "IMPORT") return { text: "Importada", estimated: false };
  return { text: saleStage(input.ticketType, input.orderedAt), estimated: true };
}

export type SoldFilter = {
  eventId: string;
  sessionId?: string;
  /** Busca por código, código del proveedor, titular, comprador o carnet. */
  q?: string;
  status?: TicketStatus;
  /** Solo las que cambiaron de manos. */
  transferred?: boolean;
  page?: number;
  pageSize?: number;
};

const ticketInclude = {
  order: { select: { code: true, channel: true, buyerName: true, buyerEmail: true, buyerDocument: true, createdAt: true, paidAt: true } },
  orderItem: { select: { name: true, unitAmount: true, saleStage: true, extraConsumption: true } },
  ticketType: {
    select: { name: true, phaseOrder: true, discountPercent: true, discountStartsAt: true, discountEndsAt: true },
  },
  session: { select: { id: true, startsAt: true, venue: { select: { timezone: true } } } },
  customer: { select: { name: true } },
} satisfies Prisma.TicketInclude;

function shape(t: Prisma.TicketGetPayload<{ include: typeof ticketInclude }>) {
  const orderedAt = t.order.paidAt ?? t.order.createdAt;
  return {
    id: t.id,
    code: t.code,
    externalCode: t.externalCode,
    status: t.status,
    sessionId: t.sessionId,
    startsAt: t.session.startsAt,
    timezone: t.session.venue.timezone,
    typeName: t.orderItem.name,
    orderCode: t.order.code,
    channel: t.order.channel,
    orderedAt,
    buyerName: t.order.buyerName,
    buyerDocument: t.order.buyerDocument,
    /** Titular actual: quien recibió la entrada por una transferencia, o el comprador. */
    holderName: t.holderName ?? t.customer?.name ?? t.order.buyerName,
    holderDocument: t.holderDocument ?? t.order.buyerDocument,
    transferCount: t.transferCount,
    changedHands: t.transferCount > 0,
    price: t.orderItem.unitAmount,
    extra: t.orderItem.extraConsumption,
    stage: soldStage({ saleStage: t.orderItem.saleStage, channel: t.order.channel, ticketType: t.ticketType, orderedAt }),
  };
}

export type SoldTicket = ReturnType<typeof shape>;

/** Una página de las entradas vendidas de un evento (más recientes primero) y cuántas hay en total con ese filtro. */
export async function listSoldTickets(filter: SoldFilter) {
  const pageSize = filter.pageSize ?? 50;
  const q = filter.q?.trim();
  const code = q?.replace(/-/g, "").toUpperCase();
  const where: Prisma.TicketWhereInput = {
    session: { eventId: filter.eventId },
    ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.transferred ? { transferCount: { gt: 0 } } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: code, mode: "insensitive" } },
            { externalCode: { contains: q, mode: "insensitive" } },
            { holderName: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
            { order: { buyerName: { contains: q, mode: "insensitive" } } },
            { order: { buyerDocument: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      include: ticketInclude,
      orderBy: [{ issuedAt: "desc" }, { id: "asc" }],
      skip: ((filter.page ?? 1) - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, rows: rows.map(shape) };
}

export type HistoryStep = {
  kind: "purchase" | "transfer";
  at: Date;
  /** Compra: el comprador. Transferencia: quien la entregó. */
  fromName: string;
  /** Solo en transferencias: quien la recibió. */
  toName?: string;
  oldCode?: string | null;
  newCode?: string | null;
};

/** La historia de una entrada, en orden: la compra y cada transferencia aceptada. */
export async function soldTicketHistory(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      ...ticketInclude,
      transfers: {
        where: { status: "ACCEPTED" },
        orderBy: { resolvedAt: "asc" },
        select: {
          createdAt: true,
          resolvedAt: true,
          oldCode: true,
          newCode: true,
          from: { select: { name: true } },
          to: { select: { name: true } },
        },
      },
    },
  });
  if (!ticket) return null;
  const base = shape(ticket);
  const steps: HistoryStep[] = [
    { kind: "purchase", at: base.orderedAt, fromName: base.buyerName },
    ...ticket.transfers.map((tr) => ({
      kind: "transfer" as const,
      at: tr.resolvedAt ?? tr.createdAt,
      fromName: tr.from.name,
      toName: tr.to.name,
      oldCode: tr.oldCode,
      newCode: tr.newCode,
    })),
  ];
  return { ...base, steps };
}
