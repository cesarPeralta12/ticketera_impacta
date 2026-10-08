import Link from "next/link";
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, formatCode, formatDateTime, formatMoney, formatTime } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { CHANNEL_LABEL, SCAN_LABEL } from "@/lib/labels";
import { startOfToday } from "@/lib/dates";

/** Resumen de IMPACTA: todos los organizadores juntos, en vivo. */
export async function GlobalDashboard({ name }: { name: string }) {
  const since = startOfToday();
  const paidToday = { status: "PAID" as const, paidAt: { gte: since } };

  const [organizers, onSale, pending, salesToday, revenueToday, tickets, entriesToday, pendingEvents, lastOrders, lastScans] =
    await Promise.all([
      prisma.organization.count({ where: { isPlatform: false, status: "ACTIVE" } }),
      prisma.event.count({ where: { status: "PUBLISHED", organization: { status: "ACTIVE" } } }),
      prisma.event.count({ where: { status: "PENDING_REVIEW" } }),
      prisma.order.count({ where: paidToday }),
      prisma.order.aggregate({ _sum: { totalAmount: true }, where: { ...paidToday, currency: DEFAULT_CURRENCY } }),
      prisma.ticket.count({ where: { status: { in: ["VALID", "USED"] } } }),
      prisma.accessScan.count({ where: { result: "ACCEPTED", scannedAt: { gte: since } } }),
      prisma.event.findMany({
        where: { status: "PENDING_REVIEW" },
        orderBy: { submittedAt: "asc" },
        take: 5,
        include: { organization: { select: { name: true } } },
      }),
      prisma.order.findMany({
        where: { status: "PAID" },
        orderBy: { paidAt: "desc" },
        take: 8,
        include: {
          items: {
            take: 1,
            select: { ticketType: { select: { session: { select: { event: { select: { title: true, organization: { select: { name: true } } } } } } } } },
          },
          _count: { select: { tickets: true } },
        },
      }),
      prisma.accessScan.findMany({
        orderBy: { scannedAt: "desc" },
        take: 8,
        include: {
          ticket: { select: { holderName: true, order: { select: { buyerName: true } } } },
          session: { select: { event: { select: { title: true, organization: { select: { name: true } } } }, venue: { select: { timezone: true } } } },
        },
      }),
    ]);

  const stats = [
    { label: "Organizadores activos", value: organizers, href: "/organizadores" },
    { label: "Eventos a la venta", value: onSale },
    { label: "Esperando aprobación", value: pending, href: "/aprobaciones", warn: pending > 0 },
    { label: "Ventas de hoy", value: `${salesToday} · ${formatMoney(revenueToday._sum.totalAmount ?? 0, DEFAULT_CURRENCY)}`, href: "/ordenes" },
    { label: "Entradas emitidas", value: tickets },
    { label: "Ingresos hoy en puerta", value: entriesToday, href: "/ingresos" },
  ];

  return (
    <div className="space-y-8">
      <AutoRefresh seconds={30} />
      <div>
        <p className="eyebrow">Hola, {name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Resumen general</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Todos los organizadores juntos, en vivo (se actualiza cada 30 segundos).
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {stats.map((s) => {
          const body = (
            <>
              <dt className="eyebrow">{s.label}</dt>
              <dd className={`mt-1 text-2xl font-semibold tabular-nums ${s.warn ? "text-[var(--warn)]" : ""}`}>{s.value}</dd>
            </>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className="card p-4 transition-colors hover:border-[var(--accent)]">
              {body}
            </Link>
          ) : (
            <div key={s.label} className="card p-4">
              {body}
            </div>
          );
        })}
      </dl>

      {pendingEvents.length > 0 && (
        <section className="card border-[var(--warn)]/40">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
            <h2 className="eyebrow">Esperando tu aprobación</h2>
            <Link href="/aprobaciones" className="text-sm text-[var(--accent)] hover:underline">
              Revisar →
            </Link>
          </div>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {pendingEvents.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5">
                <span>
                  <span className="font-medium">{e.title}</span>
                  <span className="text-[var(--ink-dim)]"> · {e.organization.name}</span>
                </span>
                <span className="text-xs text-[var(--ink-dim)]">
                  {e.submittedAt ? formatDateTime(e.submittedAt, DEFAULT_TIMEZONE) : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
            <h2 className="eyebrow">Últimas compras</h2>
            <Link href="/ordenes" className="text-sm text-[var(--accent)] hover:underline">
              Ver todas →
            </Link>
          </div>
          {lastOrders.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">Todavía no hay compras.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {lastOrders.map((o) => {
                const event = o.items[0]?.ticketType.session.event;
                return (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                    <span className="min-w-0">
                      <span className="font-medium">{o.buyerName}</span>
                      <span className="block truncate text-xs text-[var(--ink-dim)]">
                        {event?.title} · {event?.organization.name} · {CHANNEL_LABEL[o.channel]} · {formatCode(o.code)}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono">{formatMoney(o.totalAmount, o.currency)}</span>
                      <span className="text-xs text-[var(--ink-dim)]">
                        {o._count.tickets} entrada(s) · {o.paidAt ? formatTime(o.paidAt, DEFAULT_TIMEZONE) : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
            <h2 className="eyebrow">Últimos ingresos en puerta</h2>
            <Link href="/ingresos" className="text-sm text-[var(--accent)] hover:underline">
              Ver todos →
            </Link>
          </div>
          {lastScans.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">Todavía no hay lecturas en puerta.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {lastScans.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                  <span className="min-w-0">
                    <span className="font-medium">{s.ticket?.holderName ?? s.ticket?.order.buyerName ?? "QR no reconocido"}</span>
                    <span className="block truncate text-xs text-[var(--ink-dim)]">
                      {s.session.event.title} · {s.session.event.organization.name}
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    <span className={s.result === "ACCEPTED" ? "font-medium text-[var(--accent)]" : "font-medium text-[var(--danger)]"}>
                      {SCAN_LABEL[s.result]}
                    </span>
                    <span className="block text-[var(--ink-dim)]">{formatTime(s.scannedAt, s.session.venue.timezone)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
