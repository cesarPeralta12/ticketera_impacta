import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, commissionLabel, formatCode, formatDateTime, formatMoney, whatsappLink } from "@ticketera/core";
import { prisma, promoterEvents, promoterSales, requireEnv, salesCutoff } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { CopyButton } from "@/components/copy-button";
import { CountUp } from "@/components/count-up";
import { ticketsMessage } from "@/lib/promoter-payments";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Vender" };

const CHANNEL: Record<string, string> = { PROMOTER: "Vendida por ti", ONLINE: "Web con tu código", POS: "Boletería con tu código" };

/**
 * Inicio del promotor: su comisión en vivo, los eventos que vende (con su enlace para la web) y sus últimas ventas.
 * Vende con cobro por QR: nunca recibe efectivo.
 */
export default async function PromoterHome() {
  await connection();
  const staff = await requireStaff(ROLES.promoter);
  const now = new Date();
  const [assignments, sales, code] = await Promise.all([
    promoterEvents(staff.id, staff.organization.id, now),
    promoterSales(staff.id, { organizationId: staff.organization.id, take: 25 }, now),
    prisma.promoCode.findFirst({ where: { organizationId: staff.organization.id, promoterId: staff.id, eventId: null, discountValue: 0 }, select: { code: true } }),
  ]);
  const currency = staff.organization.currency;
  const money = (c: number) => formatMoney(c, currency);
  const web = requireEnv("WEB_URL").replace(/\/$/, "");

  const stats = [
    {
      label: "Tu comisión",
      value: money(sales.totals.commission),
      note: sales.totals.toSettle > 0 ? `${money(sales.totals.toSettle)} por cobrarle a iPass` : "de lo ya pagado (todo liquidado)",
      tone: "magenta",
    },
    {
      label: "Hoy",
      value: money(sales.today.commission),
      note: `${sales.today.tickets} entrada(s) · ${money(sales.today.amount)} cobrado`,
      tone: "magenta",
    },
    { label: "Entradas vendidas", value: sales.totals.tickets, note: `${sales.totals.orders} venta(s) pagada(s)`, tone: "blue" },
    { label: "Cobrado a tus clientes", value: money(sales.totals.amount), note: "por QR", tone: "blue" },
    {
      label: "Esperando pago",
      value: sales.totals.waitingOrders,
      note: sales.totals.waitingOrders > 0 ? `${money(sales.totals.waitingCommission)} más de comisión al pagarse` : "ningún cobro abierto",
      tone: "amber",
    },
  ];

  return (
    <div className="space-y-8">
      <AutoRefresh seconds={15} />
      <div>
        <p className="eyebrow">Hola, {staff.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Vender y mi comisión</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          <span className="live-dot mr-1.5" aria-hidden /> Tu comisión sube sola cuando el cliente paga (se actualiza cada 15 segundos). El cobro es
          siempre por QR: no recibes efectivo.
        </p>
      </div>

      <dl className="stats grid grid-cols-2 gap-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className={`card tone-${s.tone} p-4`}>
            <dt className="eyebrow">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{typeof s.value === "number" ? <CountUp value={s.value} /> : s.value}</dd>
            <dd className="text-xs text-[var(--ink-dim)]">{s.note}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3">
        <h2 className="eyebrow">Tus eventos</h2>
        {assignments.length === 0 ? (
          <p className="card p-5 text-sm text-[var(--ink-muted)]">Todavía no tienes eventos asignados. Pídele a iPass que te asigne los que vas a vender.</p>
        ) : (
          assignments.map(({ event, scope, ...rule }) => {
            // Solo las funciones que tiene asignadas (y vigentes) y que todavía se venden.
            const onSale = event.status === "PUBLISHED" ? event.sessions.filter((s) => s.assigned && salesCutoff(s, "PROMOTER") > now) : [];
            const sold = sales.byEvent.find((e) => e.eventId === event.id);
            const link = code ? `${web}/eventos/${event.slug}?promo=${code.code}` : null;
            return (
              <article key={event.id} className="card overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
                  <div>
                    <h3 className="font-semibold">{event.title}</h3>
                    <p className="text-sm text-[var(--ink-muted)]">
                      Tu comisión: {commissionLabel(rule, money)}
                      {rule.quota ? ` · tu cupo: ${rule.quota} entradas` : ""}
                      {scope.endsAt ? ` · vendes hasta el ${formatDateTime(scope.endsAt, DEFAULT_TIMEZONE)}` : ""}
                    </p>
                    {sold && (
                      <p className="text-xs text-[var(--ink-dim)]">
                        Vendiste {sold.tickets} entrada(s) · {money(sold.commission)} de comisión
                      </p>
                    )}
                  </div>
                  {link && event.status === "PUBLISHED" && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <CopyButton text={link} label="Copiar tu enlace para la web" />
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(`Compra tus entradas para ${event.title} aquí: ${link}`)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn px-2.5 py-1 text-xs"
                      >
                        Compartir por WhatsApp
                      </a>
                    </div>
                  )}
                </div>
                {onSale.length === 0 ? (
                  <p className="px-5 py-3 text-sm text-[var(--ink-muted)]">
                    {event.status === "PUBLISHED" ? "No tiene funciones a la venta ahora." : "Todavía no está a la venta."}
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--border)]">
                    {onSale.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                        <span className="text-sm">
                          <span className="block font-medium capitalize">{formatDateTime(s.startsAt, s.venue.timezone)}</span>
                          <span className="text-[var(--ink-dim)]">{s.venue.name}</span>
                        </span>
                        <Link href={`/promotor/vender/${s.id}`} className="btn btn-primary px-4 py-2 text-sm">
                          Vender
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })
        )}
        {code && (
          <p className="text-xs text-[var(--ink-dim)]">
            Tu código es <strong className="font-mono">{code.code}</strong>: lo que se compra en la web con tu enlace o con este código también suma a tu
            comisión.
          </p>
        )}
      </section>

      <section className="card overflow-x-auto">
        <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">Tus últimas ventas</h2>
        {sales.recent.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">Todavía no vendiste. Elige un evento arriba y toca «Vender».</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="eyebrow border-b border-[var(--border)]">
              <tr>
                <th className="px-5 py-2.5 font-normal">Cliente</th>
                <th className="px-5 py-2.5 font-normal">Evento</th>
                <th className="px-5 py-2.5 text-right font-normal">Monto</th>
                <th className="px-5 py-2.5 text-right font-normal">Comisión</th>
                <th className="px-5 py-2.5 font-normal">Estado</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sales.recent.map((o) => {
                const paid = o.status === "PAID" || o.status === "PARTIALLY_REFUNDED";
                const waiting = o.status === "PENDING_PAYMENT" && o.expiresAt > now;
                const wa = paid && o.buyerPhone && o.event ? whatsappLink(o.buyerPhone, ticketsMessage(o.buyerName, o.event.title, o.code)) : null;
                return (
                  <tr key={o.id}>
                    <td className="px-5 py-2.5">
                      <span className="block font-medium">{o.buyerName}</span>
                      <span className="text-xs text-[var(--ink-dim)]">
                        {CHANNEL[o.channel] ?? o.channel} · {formatCode(o.code)}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      {o.event?.title}
                      {paid && <span className="block text-xs text-[var(--ink-dim)]">{o._count.tickets} entrada(s)</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono">{formatMoney(o.totalAmount, o.currency)}</td>
                    <td className={`px-5 py-2.5 text-right font-mono ${paid ? "font-semibold text-[var(--success)]" : "text-[var(--ink-dim)]"}`}>
                      {formatMoney(o.commissionAmount, o.currency)}
                    </td>
                    <td className="px-5 py-2.5">
                      <span
                        className={`badge ${
                          paid
                            ? "bg-[var(--success-soft)] text-[var(--success)]"
                            : waiting
                              ? "bg-[var(--warn-soft)] text-[var(--warn)]"
                              : "bg-[var(--surface-2)] text-[var(--ink-dim)]"
                        }`}
                      >
                        {paid ? "Pagada" : waiting ? "Esperando pago" : o.status === "CANCELLED" ? "Anulada" : o.status === "REFUNDED" ? "Devuelta" : "Venció sin pagar"}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {o.channel === "PROMOTER" && (waiting || paid) && (
                        <Link href={`/promotor/cobro/${o.code}`} className="text-xs text-[var(--accent)] hover:underline">
                          {waiting ? "Ver el QR de cobro" : "Ver"}
                        </Link>
                      )}
                      {wa && (
                        <a href={wa} target="_blank" rel="noreferrer" className="ml-3 text-xs text-[var(--accent)] hover:underline">
                          WhatsApp
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
