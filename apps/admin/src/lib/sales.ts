import { DEFAULT_TIMEZONE, formatCode, formatDateTime, zonedDateTimeToUtc } from "@ticketera/core";
import { BOX_OFFICE_BUYER, prisma, type OrderChannel, type OrderStatus, type Prisma, type StaffRole } from "@ticketera/db";
import { CHANNEL_LABEL } from "./labels";
import { eventScope, isGlobalView, type Staff } from "./session";

export const ORDER_STATUSES: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAID",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
];

export const ORDER_CHANNELS: OrderChannel[] = ["ONLINE", "POS", "PROMOTER", "GUEST", "PRINTED", "IMPORT"];

export const STATUS_TEXT: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagada",
  EXPIRED: "Expirada",
  CANCELLED: "Anulada",
  REFUNDED: "Devuelta",
  PARTIALLY_REFUNDED: "Reembolso parcial",
};

/** Cómo se cobró, según el proveedor del pago ("pos_efectivo", "directo", "simulado", o la pasarela). */
export const METHOD_LABEL: Record<string, string> = {
  pos_efectivo: "Efectivo (caja)",
  pos_qr: "QR declarado (caja)",
  pos_tarjeta: "Tarjeta (caja)",
  directo: "Pase directo (web, sin cobro)",
  simulado: "QR de pasarela (prueba)",
  mock: "Pasarela (simulada)",
  impresa_efectivo: "Efectivo (impresa)",
  impresa_qr: "QR declarado (impresa)",
  impresa_transferencia: "Transferencia (impresa)",
};

export const methodName = (provider: string) => METHOD_LABEL[provider] ?? `QR de pasarela (${provider})`;

/** El medio de la venta: el del pago aprobado (o el último intento). Sin pagos: invitación, impresa o importada. */
export function paymentMethodLabel(payments: { provider: string; status: string }[]) {
  const payment = payments.find((p) => p.status === "APPROVED" || p.status === "REFUNDED") ?? payments[0];
  return payment ? methodName(payment.provider) : "—";
}

/** Quién hizo la venta: el cajero o el promotor (con su rol), "Web" si la compró el comprador. */
export function sellerOf(order: {
  channel: OrderChannel;
  issuedBy?: { name: string; memberships: { role: StaffRole }[] } | null;
  promoter?: { name: string } | null;
}): { name: string; role: StaffRole | null } {
  if (order.channel === "ONLINE") return { name: order.promoter ? `Web · código de ${order.promoter.name}` : "Web", role: null };
  if (order.channel === "IMPORT") return { name: "Importada (Excel)", role: null };
  if (order.channel === "PRINTED") return { name: order.issuedBy?.name ? `Impresa · ${order.issuedBy.name}` : "Impresa", role: null };
  const role = order.channel === "PROMOTER" ? "PROMOTER" : (order.issuedBy?.memberships[0]?.role ?? null);
  return { name: order.issuedBy?.name ?? CHANNEL_LABEL[order.channel], role };
}

export type SalesFilters = {
  q?: string;
  estado?: string;
  org?: string;
  /** Evento y función. */
  evento?: string;
  funcion?: string;
  /** "web" o el id de la cuenta (cajero o promotor). */
  vendedor?: string;
  canal?: string;
  /** Proveedor del pago ("pos_efectivo", "directo", la pasarela…). */
  metodo?: string;
  /** Días (YYYY-MM-DD, hora de Bolivia), los dos incluidos. */
  desde?: string;
  hasta?: string;
};

export const SALES_FILTER_KEYS = ["q", "estado", "org", "evento", "funcion", "vendedor", "canal", "metodo", "desde", "hasta"] as const;

export function readSalesFilters(params: URLSearchParams | Record<string, string | string[] | undefined>): SalesFilters {
  const get = (key: string) => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key];
    return typeof value === "string" ? value.trim() : "";
  };
  return Object.fromEntries(SALES_FILTER_KEYS.map((k) => [k, get(k)])) as SalesFilters;
}

const day = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

/**
 * Filtro de órdenes según quién mira (IMPACTA: todas o un organizador; un organizador: las
 * suyas) y lo que buscó. Lo comparten la pantalla de Ventas y su exportación.
 */
export function salesWhere(staff: Staff, filters: SalesFilters): Prisma.OrderWhereInput {
  const term = filters.q?.trim() ?? "";
  const eventFilter: Prisma.EventWhereInput =
    isGlobalView(staff) && filters.org ? { organizationId: filters.org } : eventScope(staff);
  const from = day(filters.desde);
  const to = day(filters.hasta);
  const next = (d: string) => {
    const date = new Date(`${d}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  };
  const and: Prisma.OrderWhereInput[] = [];
  if (filters.vendedor === "web") and.push({ channel: "ONLINE" });
  else if (filters.vendedor) and.push({ OR: [{ issuedById: filters.vendedor }, { promoterId: filters.vendedor }] });
  if (filters.metodo) and.push({ payments: { some: { provider: filters.metodo, status: { in: ["APPROVED", "REFUNDED"] } } } });
  if (term) {
    and.push({
      OR: [
        { buyerName: { contains: term, mode: "insensitive" } },
        { buyerEmail: { contains: term, mode: "insensitive" } },
        { buyerDocument: { contains: term } },
        { code: { contains: term.replace(/[\s-]/g, "").toUpperCase() } },
      ],
    });
  }
  return {
    items: {
      some: {
        ticketType: {
          ...(filters.funcion ? { sessionId: filters.funcion } : {}),
          session: { event: eventFilter, ...(filters.evento ? { eventId: filters.evento } : {}) },
        },
      },
    },
    // Las entradas impresas son ventas recién cuando se marcan vendidas.
    NOT: { channel: "PRINTED", paidAt: null },
    ...(ORDER_STATUSES.includes(filters.estado as OrderStatus) ? { status: filters.estado as OrderStatus } : {}),
    ...(ORDER_CHANNELS.includes(filters.canal as OrderChannel) ? { channel: filters.canal as OrderChannel } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: zonedDateTimeToUtc(`${from}T00:00`, DEFAULT_TIMEZONE) } : {}),
            ...(to ? { lt: zonedDateTimeToUtc(`${next(to)}T00:00`, DEFAULT_TIMEZONE) } : {}),
          },
        }
      : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

/** Cuántas ventas hay con esos filtros (para las páginas). */
export function countSales(staff: Staff, filters: SalesFilters) {
  return prisma.order.count({ where: salesWhere(staff, filters) });
}

export function listSales(staff: Staff, filters: SalesFilters, take: number, skip = 0) {
  return prisma.order.findMany({
    where: salesWhere(staff, filters),
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: {
      items: {
        include: {
          ticketType: { include: { session: { include: { event: { include: { organization: true } }, venue: true } } } },
        },
      },
      payments: { orderBy: { createdAt: "desc" } },
      issuedBy: { select: { name: true, memberships: { select: { role: true } } } },
      promoter: { select: { name: true } },
      promoRedemption: { select: { promoCode: { select: { code: true } } } },
      _count: { select: { tickets: true } },
    },
  });
}

export type SaleRow = Awaited<ReturnType<typeof listSales>>[number];

/** Resúmenes de lo pagado con los filtros: total, por vendedor y por medio de cobro. */
export async function salesSummary(staff: Staff, filters: SalesFilters) {
  const where = { ...salesWhere(staff, filters), status: { in: ["PAID", "PARTIALLY_REFUNDED"] as OrderStatus[] } };
  const [total, bySeller, byMethod] = await Promise.all([
    prisma.order.aggregate({ where, _sum: { totalAmount: true, discountAmount: true }, _count: true }),
    prisma.order.groupBy({ by: ["channel", "issuedById"], where, _sum: { totalAmount: true }, _count: true }),
    prisma.payment.groupBy({ by: ["provider"], where: { status: "APPROVED", order: where }, _sum: { amount: true }, _count: true }),
  ]);
  const ids = [...new Set(bySeller.flatMap((s) => (s.issuedById ? [s.issuedById] : [])))];
  const names = new Map((await prisma.staffUser.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const seller = (s: (typeof bySeller)[number]) =>
    s.channel === "ONLINE"
      ? "Web"
      : s.channel === "IMPORT"
        ? "Importadas"
        : s.channel === "GUEST"
          ? `Invitaciones${s.issuedById ? ` · ${names.get(s.issuedById) ?? ""}` : ""}`
          : `${(s.issuedById && names.get(s.issuedById)) || CHANNEL_LABEL[s.channel]}${s.channel === "PROMOTER" ? " (promotor)" : s.channel === "PRINTED" ? " (impresas)" : ""}`;
  return {
    count: total._count,
    amount: total._sum.totalAmount ?? 0,
    discount: total._sum.discountAmount ?? 0,
    bySeller: bySeller.map((s) => ({ name: seller(s), count: s._count, amount: s._sum.totalAmount ?? 0 })).toSorted((a, b) => b.amount - a.amount),
    byMethod: byMethod.map((m) => ({ name: methodName(m.provider), count: m._count, amount: m._sum.amount ?? 0 })).toSorted((a, b) => b.amount - a.amount),
  };
}

/** Lo que se puede elegir en los filtros: eventos, funciones del evento elegido y vendedores. */
export async function salesFilterOptions(staff: Staff, filters: SalesFilters) {
  const scope = isGlobalView(staff) && filters.org ? { organizationId: filters.org } : eventScope(staff);
  const [events, sessions, sellers] = await Promise.all([
    prisma.event.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 300, select: { id: true, title: true } }),
    filters.evento
      ? prisma.eventSession.findMany({ where: { eventId: filters.evento, event: scope }, orderBy: { startsAt: "asc" }, select: { id: true, startsAt: true, venue: { select: { timezone: true } } } })
      : [],
    prisma.staffUser.findMany({
      where: {
        OR: [{ issuedOrders: { some: { items: { some: { ticketType: { session: { event: scope } } } } } } }, { promoterOrders: { some: { items: { some: { ticketType: { session: { event: scope } } } } } } }],
      },
      orderBy: { name: "asc" },
      take: 300,
      select: { id: true, name: true },
    }),
  ]);
  return { events, sessions: sessions.map((s) => ({ id: s.id, label: formatDateTime(s.startsAt, s.venue.timezone) })), sellers };
}

/** Las columnas de la exportación (CSV y Excel): las mismas que la pantalla, una fila por venta. */
export function salesExport(orders: SaleRow[], global: boolean) {
  const header = [
    "Fecha",
    "Orden",
    "Estado",
    "Vendedor",
    "Canal",
    "Medio de cobro",
    "Referencia del pago",
    "Comprador",
    "CI / NIT",
    "Email",
    "WhatsApp",
    ...(global ? ["Organizador"] : []),
    "Evento",
    "Función",
    "Detalle",
    "Entradas",
    "Subtotal (Bs)",
    "Descuento (Bs)",
    "Código",
    "Total (Bs)",
    "Promotor",
    "Comisión (Bs)",
  ];
  // Los montos van en centavos: cada exportación los escribe a su modo (CSV "120,50"; Excel, número).
  const bs = (c: number) => c;
  const moneyColumns = new Set(header.flatMap((h, i) => (h.endsWith("(Bs)") ? [i] : [])));
  const rows = orders.map((o) => {
    const session = o.items[0]?.ticketType.session;
    const tz = session?.venue.timezone ?? DEFAULT_TIMEZONE;
    const approved = o.payments.find((p) => p.status === "APPROVED" || p.status === "REFUNDED") ?? o.payments[0];
    return [
      formatDateTime(o.createdAt, tz),
      formatCode(o.code),
      STATUS_TEXT[o.status] ?? o.status,
      sellerOf(o).name,
      CHANNEL_LABEL[o.channel],
      paymentMethodLabel(o.payments),
      approved?.providerPaymentId ?? "",
      o.buyerName,
      o.buyerDocument ?? "",
      o.buyerEmail === BOX_OFFICE_BUYER.email ? "" : o.buyerEmail,
      o.buyerPhone ?? "",
      ...(global ? [session?.event.organization.name ?? ""] : []),
      session?.event.title ?? "",
      session ? formatDateTime(session.startsAt, tz) : "",
      o.items.map((i) => `${i.quantity} x ${i.name}`).join(", "),
      o._count.tickets,
      bs(o.subtotalAmount),
      bs(o.discountAmount),
      o.promoRedemption?.promoCode.code ?? "",
      bs(o.totalAmount),
      o.promoter?.name ?? "",
      bs(o.commissionAmount),
    ];
  });
  return { header, rows, moneyColumns };
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
    channel: { in: ["ONLINE", "POS", "PROMOTER"] },
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
