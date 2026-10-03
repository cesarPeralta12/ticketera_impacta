import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import {
  DEFAULT_TIMEZONE,
  formatCode,
  formatDateTime,
  formatMoney,
  formatTime,
  utcToZonedInput,
  zonedDateTimeToUtc,
} from "@ticketera/core";
import { BOX_OFFICE_HOURS_AFTER_START, prisma, salesCutoff } from "@ticketera/db";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Boletería" };

const METHOD_LABEL: Record<string, string> = { pos_efectivo: "Efectivo", pos_qr: "QR", pos_tarjeta: "Tarjeta" };

/** Funciones que la boletería puede vender ahora (también durante el evento). */
async function sessionsOnSale(organizationId: string) {
  const now = new Date();
  const sessions = await prisma.eventSession.findMany({
    where: {
      cancelledAt: null,
      startsAt: { gt: new Date(now.getTime() - 48 * 60 * 60_000) },
      event: { organizationId, status: "PUBLISHED", mode: "TICKETING" },
      ticketTypes: { some: {} },
    },
    orderBy: { startsAt: "asc" },
    include: { event: { select: { title: true } }, venue: { select: { name: true, timezone: true } } },
  });
  return sessions
    .filter((s) => salesCutoff(s, "POS") > now)
    .map((s) => ({ ...s, started: s.startsAt <= now }));
}

/** Ventas de hoy (hora de Bolivia) de este cajero: su arqueo de caja. */
async function myDay(staffId: string) {
  const today = utcToZonedInput(new Date(), DEFAULT_TIMEZONE).slice(0, 10);
  const since = zonedDateTimeToUtc(`${today}T00:00`, DEFAULT_TIMEZONE);
  const sales = await prisma.order.findMany({
    where: { channel: "POS", issuedById: staffId, status: "PAID", paidAt: { gte: since } },
    orderBy: { paidAt: "desc" },
    include: {
      payments: { where: { status: "APPROVED" }, select: { provider: true }, take: 1 },
      items: { take: 1, select: { ticketType: { select: { session: { select: { event: { select: { title: true } } } } } } } },
      _count: { select: { tickets: true } },
    },
  });
  const byMethod = new Map<string, { tickets: number; total: number }>();
  for (const sale of sales) {
    const method = METHOD_LABEL[sale.payments[0]?.provider ?? ""] ?? "—";
    const line = byMethod.get(method) ?? { tickets: 0, total: 0 };
    line.tickets += sale._count.tickets;
    line.total += sale.totalAmount;
    byMethod.set(method, line);
  }
  return { sales, byMethod: [...byMethod.entries()] };
}

export default async function BoxOfficePage() {
  await connection();
  const staff = await requireStaff(ROLES.pos);
  const [sessions, day] = await Promise.all([sessionsOnSale(staff.organization.id), myDay(staff.id)]);
  const currency = staff.organization.currency;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Boletería</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Venta presencial. Comparte el mismo cupo que la venta online: nunca se vende de más. Se puede vender durante
          el evento (hasta que termina o {BOX_OFFICE_HOURS_AFTER_START} h después del inicio).
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="eyebrow">Funciones a la venta</h2>
        {sessions.length === 0 ? (
          <p className="card p-5 text-sm text-[var(--ink-muted)]">No hay funciones publicadas a la venta.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/boleteria/${s.id}`} className="card block p-5 transition-colors hover:border-[var(--accent)]">
                  <p className="font-medium">{s.event.title}</p>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {formatDateTime(s.startsAt, s.venue.timezone)} · {s.venue.name}
                  </p>
                  {s.started && <span className="badge mt-2 bg-[var(--warn-soft)] text-[var(--warn)]">En curso</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="eyebrow mb-3">Mi caja de hoy</h2>
        {day.sales.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">Todavía no vendiste hoy.</p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-6">
              {day.byMethod.map(([method, line]) => (
                <div key={method}>
                  <p className="eyebrow">{method}</p>
                  <p className="font-mono text-lg">{formatMoney(line.total, currency)}</p>
                  <p className="text-xs text-[var(--ink-dim)]">{line.tickets} entradas</p>
                </div>
              ))}
              <div>
                <p className="eyebrow">Total</p>
                <p className="font-mono text-lg font-semibold">
                  {formatMoney(
                    day.byMethod.reduce((sum, [, l]) => sum + l.total, 0),
                    currency,
                  )}
                </p>
              </div>
            </div>
            <ul className="divide-y divide-[var(--border)] text-sm">
              {day.sales.slice(0, 15).map((sale) => (
                <li key={sale.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-mono text-xs">{formatTime(sale.paidAt!, DEFAULT_TIMEZONE)}</span> ·{" "}
                    {sale.items[0]?.ticketType.session.event.title} · {sale._count.tickets} entrada(s)
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono">{formatMoney(sale.totalAmount, sale.currency)}</span>
                    <Link href={`/boleteria/ticket/${sale.code}`} className="text-xs text-[var(--accent)] hover:underline">
                      {formatCode(sale.code)} · reimprimir
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
