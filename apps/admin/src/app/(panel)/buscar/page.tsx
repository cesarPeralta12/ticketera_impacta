import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatCode, formatDateTime, formatMoney } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { CHANNEL_LABEL, EVENT_STATUS, TICKET_STATUS } from "@/lib/labels";
import { ROLES, eventScope, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Buscar" };

type Props = { searchParams: Promise<{ q?: string }> };

const LIMIT = 8;

/**
 * Búsqueda global del panel: eventos (título o dirección web), órdenes y entradas (por código, con o sin guiones) y
 * compradores (nombre, correo o carnet). Solo dentro de lo que la cuenta puede ver.
 */
export default async function SearchPage({ searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const scope = eventScope(staff);
  const code = q.replace(/[\s-]/g, "").toUpperCase();
  const isCode = /^[A-Z0-9]{6,16}$/.test(code);
  const contains = { contains: q, mode: "insensitive" as const };
  const orderScope = { items: { some: { ticketType: { session: { event: scope } } } } };

  const [events, orders, tickets, buyers] =
    q.length < 2
      ? [[], [], [], []]
      : await Promise.all([
          prisma.event.findMany({
            where: { ...scope, OR: [{ title: contains }, { slug: contains }] },
            orderBy: { createdAt: "desc" },
            take: LIMIT,
            select: { id: true, title: true, status: true, organization: { select: { name: true } }, sessions: { orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true, venue: { select: { timezone: true } } } } },
          }),
          prisma.order.findMany({
            where: { ...orderScope, OR: [...(isCode ? [{ code }] : []), { buyerEmail: contains }, { buyerName: contains }] },
            orderBy: { createdAt: "desc" },
            take: LIMIT,
            select: {
              code: true,
              buyerName: true,
              buyerEmail: true,
              status: true,
              channel: true,
              totalAmount: true,
              currency: true,
              createdAt: true,
              items: { take: 1, select: { ticketType: { select: { session: { select: { event: { select: { title: true } } } } } } } },
            },
          }),
          isCode
            ? prisma.ticket.findMany({
                where: { code, session: { event: scope } },
                take: LIMIT,
                select: { code: true, status: true, holderName: true, ticketType: { select: { name: true } }, session: { select: { event: { select: { title: true } } } } },
              })
            : [],
          prisma.order.groupBy({
            by: ["buyerEmail", "buyerName"],
            where: { ...orderScope, status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, OR: [{ buyerEmail: contains }, { buyerName: contains }, { buyerDocument: contains }] },
            _count: true,
            orderBy: { _count: { buyerEmail: "desc" } },
            take: LIMIT,
          }),
        ]);
  const total = events.length + orders.length + tickets.length + buyers.length;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Buscar</h1>
        <form className="mt-3 flex gap-2" role="search">
          <input name="q" defaultValue={q} autoFocus placeholder="Evento, código de orden o de entrada, comprador, correo o carnet" className="field flex-1" />
          <button type="submit" className="btn btn-dark">
            Buscar
          </button>
        </form>
      </div>

      {q.length >= 2 && total === 0 && <p className="card p-6 text-sm text-[var(--ink-muted)]">No se encontró nada con &ldquo;{q}&rdquo;.</p>}

      {events.length > 0 && (
        <section className="card p-5">
          <h2 className="eyebrow mb-2">Eventos</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {events.map((e) => (
              <li key={e.id}>
                <Link href={`/eventos/${e.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:text-[var(--accent)]">
                  <span>
                    <strong>{e.title}</strong>
                    {e.sessions[0] && <span className="text-[var(--ink-muted)]"> · {formatDateTime(e.sessions[0].startsAt, e.sessions[0].venue.timezone)}</span>}
                    {staff.platform && <span className="text-[var(--ink-dim)]"> · {e.organization.name}</span>}
                  </span>
                  <span className={`badge ${EVENT_STATUS[e.status].className}`}>{EVENT_STATUS[e.status].text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tickets.length > 0 && (
        <section className="card p-5">
          <h2 className="eyebrow mb-2">Entradas</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {tickets.map((t) => (
              <li key={t.code}>
                <Link href={`/entradas/${t.code}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:text-[var(--accent)]">
                  <span>
                    <span className="font-mono">{formatCode(t.code)}</span> · {t.holderName ?? "—"} · {t.ticketType.name} · {t.session.event.title}
                  </span>
                  <span className={`badge ${TICKET_STATUS[t.status].className}`}>{TICKET_STATUS[t.status].text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {orders.length > 0 && (
        <section className="card p-5">
          <h2 className="eyebrow mb-2">Órdenes</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {orders.map((o) => (
              <li key={o.code}>
                <Link href={`/ordenes?q=${o.code}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:text-[var(--accent)]">
                  <span>
                    <span className="font-mono">{formatCode(o.code)}</span> · {o.buyerName}
                    {o.buyerEmail && <span className="text-[var(--ink-muted)]"> ({o.buyerEmail})</span>} · {o.items[0]?.ticketType.session.event.title}
                  </span>
                  <span className="text-xs text-[var(--ink-muted)]">
                    {CHANNEL_LABEL[o.channel]} · {formatMoney(o.totalAmount, o.currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {buyers.length > 0 && (
        <section className="card p-5">
          <h2 className="eyebrow mb-2">Compradores</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {buyers.map((b) => (
              <li key={`${b.buyerEmail}|${b.buyerName}`}>
                <Link href={`/compradores?q=${encodeURIComponent(b.buyerEmail || b.buyerName)}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:text-[var(--accent)]">
                  <span>
                    <strong>{b.buyerName}</strong> {b.buyerEmail && <span className="text-[var(--ink-muted)]">· {b.buyerEmail}</span>}
                  </span>
                  <span className="text-xs text-[var(--ink-muted)]">{b._count} compra(s)</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
