import { BOX_OFFICE_BUYER, prisma, type OrderStatus, type Prisma } from "@ticketera/db";
import { eventScope, isGlobalView, type Staff } from "./session";

export const ORDER_STATUSES: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAID",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
];

export type SalesFilters = { q?: string; estado?: string; org?: string };

/**
 * Filtro de órdenes según quién mira (IMPACTA: todas o un organizador; un organizador: las
 * suyas) y lo que buscó. Lo comparten la pantalla de Ventas y su exportación.
 */
export function salesWhere(staff: Staff, filters: SalesFilters): Prisma.OrderWhereInput {
  const term = filters.q?.trim() ?? "";
  const eventFilter: Prisma.EventWhereInput =
    isGlobalView(staff) && filters.org ? { organizationId: filters.org } : eventScope(staff);
  return {
    items: { some: { ticketType: { session: { event: eventFilter } } } },
    ...(ORDER_STATUSES.includes(filters.estado as OrderStatus) ? { status: filters.estado as OrderStatus } : {}),
    ...(term
      ? {
          OR: [
            { buyerName: { contains: term, mode: "insensitive" } },
            { buyerEmail: { contains: term, mode: "insensitive" } },
            { buyerDocument: { contains: term } },
            { code: { contains: term.replace(/[\s-]/g, "").toUpperCase() } },
          ],
        }
      : {}),
  };
}

export function listSales(staff: Staff, filters: SalesFilters, take: number) {
  return prisma.order.findMany({
    where: salesWhere(staff, filters),
    orderBy: { createdAt: "desc" },
    take,
    include: {
      items: {
        include: {
          ticketType: { include: { session: { include: { event: { include: { organization: true } }, venue: true } } } },
        },
      },
      payments: { orderBy: { createdAt: "desc" } },
      _count: { select: { tickets: true } },
    },
  });
}

export type Buyer = {
  email: string;
  name: string;
  document: string | null;
  orders: number;
  tickets: number;
  total: number;
  currency: string;
  firstPurchase: Date;
  lastPurchase: Date;
  events: string[];
  organizers: string[];
  channels: string[];
};

/**
 * Compradores: una fila por persona (por email), con todo lo que compró online o en
 * boletería. Las invitaciones no cuentan (no son compras) y las ventas de boletería sin
 * email tampoco (no identifican a nadie): se informan aparte.
 */
export async function buyersDirectory(staff: Staff, filters: { q?: string; org?: string }) {
  const base = salesWhere(staff, { q: filters.q, org: filters.org });
  const where: Prisma.OrderWhereInput = {
    ...base,
    status: { in: ["PAID", "PARTIALLY_REFUNDED"] },
    channel: { in: ["ONLINE", "POS"] },
  };
  const [orders, anonymousPos] = await Promise.all([
    prisma.order.findMany({
      where: { ...where, buyerEmail: { not: BOX_OFFICE_BUYER.email } },
      orderBy: { paidAt: "desc" },
      select: {
        buyerName: true,
        buyerEmail: true,
        buyerDocument: true,
        totalAmount: true,
        currency: true,
        paidAt: true,
        createdAt: true,
        channel: true,
        _count: { select: { tickets: true } },
        items: {
          take: 1,
          select: {
            ticketType: {
              select: { session: { select: { event: { select: { title: true, organization: { select: { name: true } } } } } } },
            },
          },
        },
      },
    }),
    prisma.order.count({ where: { ...where, channel: "POS", buyerEmail: BOX_OFFICE_BUYER.email } }),
  ]);

  const byEmail = new Map<string, Buyer>();
  for (const o of orders) {
    const email = o.buyerEmail.trim().toLowerCase();
    if (!email) continue;
    const at = o.paidAt ?? o.createdAt;
    const event = o.items[0]?.ticketType.session.event;
    const buyer =
      byEmail.get(email) ??
      ({
        email,
        name: o.buyerName, // las órdenes vienen de la más nueva a la más vieja: queda el nombre más reciente
        document: o.buyerDocument,
        orders: 0,
        tickets: 0,
        total: 0,
        currency: o.currency,
        firstPurchase: at,
        lastPurchase: at,
        events: [],
        organizers: [],
        channels: [],
      } satisfies Buyer);
    buyer.orders += 1;
    buyer.tickets += o._count.tickets;
    buyer.total += o.totalAmount;
    buyer.document ??= o.buyerDocument;
    if (at < buyer.firstPurchase) buyer.firstPurchase = at;
    if (event && !buyer.events.includes(event.title)) buyer.events.push(event.title);
    if (event && !buyer.organizers.includes(event.organization.name)) buyer.organizers.push(event.organization.name);
    if (!buyer.channels.includes(o.channel)) buyer.channels.push(o.channel);
    byEmail.set(email, buyer);
  }
  return { buyers: [...byEmail.values()], anonymousPos };
}
