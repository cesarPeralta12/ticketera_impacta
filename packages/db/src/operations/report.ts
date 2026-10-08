/**
 * Reporte de un evento: lo usan el panel de IMPACTA y el espacio temporal del cliente.
 * Todo sale de la base central, así que suma la venta online, la boletería y las invitaciones.
 */
import { prisma } from "../client";
import type { OrderChannel, ScanResult } from "../generated/prisma/client";

const ISSUED = ["VALID", "USED"] as const;

export type ChannelLine = { channel: OrderChannel; tickets: number; revenue: number };

export async function getEventReport(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      client: true,
      organization: { select: { currency: true } },
      sessions: {
        where: { cancelledAt: null },
        orderBy: { startsAt: "asc" },
        include: { venue: { select: { name: true, timezone: true } } },
      },
    },
  });
  if (!event) return null;
  const sessionIds = event.sessions.map((s) => s.id);
  const bySession = { sessionId: { in: sessionIds } };

  const [ticketsByChannel, revenueByChannel, used, issuedPerSession, usedPerSession, rejected, posSales, buyers] =
    await Promise.all([
      prisma.ticket.findMany({
        where: { ...bySession, status: { in: [...ISSUED] } },
        select: { order: { select: { channel: true } } },
      }),
      prisma.order.groupBy({
        by: ["channel"],
        where: { status: "PAID", items: { some: { ticketType: bySession } } },
        _sum: { totalAmount: true },
      }),
      prisma.ticket.count({ where: { ...bySession, status: "USED" } }),
      prisma.ticket.groupBy({ by: ["sessionId"], where: { ...bySession, status: { in: [...ISSUED] } }, _count: true }),
      prisma.ticket.groupBy({ by: ["sessionId"], where: { ...bySession, status: "USED" }, _count: true }),
      prisma.accessScan.groupBy({
        by: ["result"],
        where: { ...bySession, result: { not: "ACCEPTED" } },
        _count: true,
      }),
      prisma.order.findMany({
        where: { channel: "POS", status: "PAID", items: { some: { ticketType: bySession } } },
        select: {
          totalAmount: true,
          issuedBy: { select: { name: true } },
          payments: { where: { status: "APPROVED" }, select: { provider: true }, take: 1 },
          _count: { select: { tickets: true } },
        },
      }),
      prisma.order.count({ where: { channel: "ONLINE", status: "PAID", items: { some: { ticketType: bySession } } } }),
    ]);

  const channels: OrderChannel[] = ["ONLINE", "POS", "GUEST"];
  const byChannel: ChannelLine[] = channels.map((channel) => ({
    channel,
    tickets: ticketsByChannel.filter((t) => t.order.channel === channel).length,
    revenue: revenueByChannel.find((r) => r.channel === channel)?._sum.totalAmount ?? 0,
  }));
  const issued = byChannel.reduce((sum, c) => sum + c.tickets, 0);

  // Boletería: por cajero y medio de pago.
  const posMap = new Map<string, { cashier: string; method: string; tickets: number; revenue: number }>();
  for (const sale of posSales) {
    const cashier = sale.issuedBy?.name ?? "—";
    const method = sale.payments[0]?.provider.replace(/^pos_/, "") ?? "—";
    const key = `${cashier}|${method}`;
    const line = posMap.get(key) ?? { cashier, method, tickets: 0, revenue: 0 };
    line.tickets += sale._count.tickets;
    line.revenue += sale.totalAmount;
    posMap.set(key, line);
  }

  return {
    event,
    currency: event.organization.currency,
    issued,
    used,
    /** Emitidas que todavía no ingresaron (después del evento: ausentes). */
    absent: issued - used,
    revenue: byChannel.reduce((sum, c) => sum + c.revenue, 0),
    onlineBuyers: buyers,
    byChannel,
    sessions: event.sessions.map((s) => ({
      ...s,
      issued: issuedPerSession.find((x) => x.sessionId === s.id)?._count ?? 0,
      used: usedPerSession.find((x) => x.sessionId === s.id)?._count ?? 0,
    })),
    rejected: rejected
      .map((r) => ({ result: r.result as ScanResult, count: r._count }))
      .sort((a, b) => b.count - a.count),
    pos: [...posMap.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

export type EventReport = NonNullable<Awaited<ReturnType<typeof getEventReport>>>;

/** ¿El cliente puede ver este evento ahora? IMPACTA lo habilita y se cierra solo. */
export function clientAccessOpen(
  event: { clientAccessEnabled: boolean; clientAccessUntil: Date | null },
  now = new Date(),
) {
  return event.clientAccessEnabled && event.clientAccessUntil !== null && now < event.clientAccessUntil;
}

/** Horas que el espacio del cliente sigue abierto después de la última función. */
export const CLIENT_ACCESS_HOURS_AFTER = 24;

export async function defaultClientAccessUntil(eventId: string) {
  const last = await prisma.eventSession.findFirst({
    where: { eventId, cancelledAt: null },
    orderBy: { startsAt: "desc" },
    select: { startsAt: true, endsAt: true },
  });
  const base = last?.endsAt ?? last?.startsAt ?? new Date();
  return new Date(base.getTime() + CLIENT_ACCESS_HOURS_AFTER * 60 * 60_000);
}

/** Una fila por entrada emitida: quién es, por qué canal, si ingresó, cuándo y por qué puerta. */
export async function listEventAttendees(eventId: string) {
  return prisma.ticket.findMany({
    where: { session: { eventId, cancelledAt: null }, status: { in: [...ISSUED] } },
    orderBy: [{ session: { startsAt: "asc" } }, { holderName: "asc" }, { issuedAt: "asc" }],
    select: {
      code: true,
      status: true,
      usedAt: true,
      holderName: true,
      holderDocument: true,
      session: { select: { startsAt: true, venue: { select: { name: true, timezone: true } } } },
      ticketType: { select: { name: true, section: { select: { name: true } } } },
      seat: { select: { label: true } },
      order: { select: { code: true, channel: true, buyerName: true, buyerEmail: true, buyerDocument: true } },
      scans: {
        where: { result: "ACCEPTED" },
        take: 1,
        select: { deviceId: true, offline: true, accessPoint: { select: { name: true } } },
      },
    },
  });
}
