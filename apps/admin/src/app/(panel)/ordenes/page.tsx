import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, formatCode, formatDateTime, formatMoney } from "@ticketera/core";
import { BOX_OFFICE_BUYER, expireStaleOrders, prisma, type OrderStatus } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { CHANNEL_LABEL, ROLE_LABEL } from "@/lib/labels";
import { METHOD_LABEL, ORDER_CHANNELS, SALES_FILTER_KEYS, listSales, paymentMethodLabel, readSalesFilters, salesFilterOptions, salesSummary, sellerOf } from "@/lib/sales";
import { ROLES, isGlobalView, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ventas" };

const statusLabel: Record<OrderStatus, { text: string; className: string }> = {
  PENDING_PAYMENT: { text: "Pendiente de pago", className: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  PAID: { text: "Pagada", className: "bg-[var(--success-soft)] text-[var(--success)]" },
  EXPIRED: { text: "Expirada", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
  CANCELLED: { text: "Anulada", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
  REFUNDED: { text: "Devuelta", className: "bg-[var(--surface-2)] text-[var(--ink)]" },
  PARTIALLY_REFUNDED: { text: "Reembolso parcial", className: "bg-[var(--surface-2)] text-[var(--ink)]" },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Ventas detalladas: una fila por venta con quién la hizo (cajero, promotor o la web), por qué medio, cuándo, el
 * comprador, qué compró y cuánto. Con filtros, resúmenes (total, por vendedor y por medio) y exportación a CSV y Excel.
 * IMPACTA (vista general) ve los de todos los organizadores; un organizador, solo los de sus eventos.
 */
export default async function SalesPage({ searchParams }: Props) {
  await connection();
  await expireStaleOrders();
  const staff = await requireStaff(ROLES.manage);
  const global = isGlobalView(staff);
  const filters = readSalesFilters(await searchParams);
  const filtered = SALES_FILTER_KEYS.some((k) => filters[k]);

  const [orders, organizers, summary, options] = await Promise.all([
    listSales(staff, filters, 200),
    global ? prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    salesSummary(staff, filters),
    salesFilterOptions(staff, filters),
  ]);
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const money = (c: number) => formatMoney(c, staff.organization.currency);

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} />
      <div>
        <p className="eyebrow">{global ? "Todos los organizadores" : staff.organization.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Ventas</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Cada venta: quién la hizo y por qué medio, cuándo, el comprador, qué compró y cuánto. Se actualiza cada 30 segundos. Toca una para ver todo su
          detalle.
        </p>
      </div>

      <form data-tour="filtros-ventas" className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="label sm:col-span-2">
          Buscar
          <input name="q" defaultValue={filters.q} placeholder="Nombre, email, CI o código de orden" className="field" />
        </label>
        {global && (
          <label className="label">
            Organizador
            <select name="org" defaultValue={filters.org} className="field">
              <option value="">Todos</option>
              {organizers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="label">
          Evento
          <select name="evento" defaultValue={filters.evento} className="field">
            <option value="">Todos</option>
            {options.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        {filters.evento && options.sessions.length > 1 && (
          <label className="label">
            Función
            <select name="funcion" defaultValue={filters.funcion} className="field">
              <option value="">Todas</option>
              {options.sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="label">
          Vendedor
          <select name="vendedor" defaultValue={filters.vendedor} className="field">
            <option value="">Todos</option>
            <option value="web">Web (compra online)</option>
            {options.sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Canal
          <select name="canal" defaultValue={filters.canal} className="field">
            <option value="">Todos</option>
            {ORDER_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Medio de cobro
          <select name="metodo" defaultValue={filters.metodo} className="field">
            <option value="">Todos</option>
            {Object.entries(METHOD_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Estado
          <select name="estado" defaultValue={filters.estado} className="field">
            <option value="">Todos</option>
            {Object.entries(statusLabel).map(([value, s]) => (
              <option key={value} value={value}>
                {s.text}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Desde
          <input type="date" name="desde" defaultValue={filters.desde} className="field" />
        </label>
        <label className="label">
          Hasta
          <input type="date" name="hasta" defaultValue={filters.hasta} className="field" />
        </label>
        <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-4">
          <button type="submit" className="btn btn-primary">
            Filtrar
          </button>
          {filtered && (
            <Link href="/ordenes" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
              Limpiar
            </Link>
          )}
          <span className="ml-auto flex gap-2">
            <a href={`/ordenes/xlsx?${query}`} className="btn">
              Exportar a Excel
            </a>
            <a href={`/ordenes/csv?${query}`} className="btn">
              CSV
            </a>
          </span>
        </div>
      </form>

      <section aria-label="Resumen" className="grid gap-4 lg:grid-cols-3">
        <div className="card tone-magenta p-4">
          <p className="eyebrow">Total vendido {filtered ? "con estos filtros" : ""}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(summary.amount)}</p>
          <p className="text-xs text-[var(--ink-dim)]">
            {summary.count} venta(s) pagada(s){summary.discount > 0 ? ` · ${money(summary.discount)} en descuentos` : ""}
          </p>
        </div>
        <div className="card p-4">
          <p className="eyebrow mb-2">Por vendedor</p>
          {summary.bySeller.length === 0 ? (
            <p className="text-sm text-[var(--ink-dim)]">—</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {summary.bySeller.slice(0, 8).map((s) => (
                <li key={s.name} className="flex justify-between gap-3">
                  <span className="truncate">{s.name}</span>
                  <span className="shrink-0 font-mono">
                    {money(s.amount)} <span className="text-xs text-[var(--ink-dim)]">· {s.count}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4">
          <p className="eyebrow mb-2">Por medio de cobro</p>
          {summary.byMethod.length === 0 ? (
            <p className="text-sm text-[var(--ink-dim)]">—</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {summary.byMethod.map((m) => (
                <li key={m.name} className="flex justify-between gap-3">
                  <span className="truncate">{m.name}</span>
                  <span className="shrink-0 font-mono">
                    {money(m.amount)} <span className="text-xs text-[var(--ink-dim)]">· {m.count}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="card overflow-x-auto">
        <table className="table-cards w-full text-left text-sm">
          <thead className="eyebrow border-b border-[var(--border)]">
            <tr>
              <th className="px-4 py-3 font-normal">Orden</th>
              <th className="px-4 py-3 font-normal">Vendedor y medio</th>
              <th className="px-4 py-3 font-normal">Comprador</th>
              <th className="px-4 py-3 font-normal">Qué compró</th>
              <th className="px-4 py-3 text-right font-normal">Total</th>
              <th className="px-4 py-3 font-normal">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--ink-muted)]">
                  {filtered ? "Ninguna venta con estos filtros." : "Todavía no hay ventas."}
                </td>
              </tr>
            )}
            {orders.map((order) => {
              const session = order.items[0]?.ticketType.session;
              const approved = order.payments.filter((p) => p.status === "APPROVED").length;
              // Pago aprobado sin entradas que entregar, o pagado dos veces.
              const refundPending = (order.status === "EXPIRED" && approved > 0) || (order.status === "PAID" && approved > 1);
              const status = statusLabel[order.status];
              const email = order.buyerEmail === BOX_OFFICE_BUYER.email ? "" : order.buyerEmail;
              const seller = sellerOf(order);
              return (
                <tr key={order.id} className="align-top">
                  <td data-label="Orden" className="px-4 py-3">
                    <Link href={`/ordenes/${order.code}`} className="font-mono hover:underline">
                      {formatCode(order.code)}
                    </Link>
                    <p className="text-xs text-[var(--ink-muted)]">{formatDateTime(order.createdAt, session?.venue.timezone ?? DEFAULT_TIMEZONE)}</p>
                  </td>
                  <td data-label="Vendedor" className="px-4 py-3">
                    <p>{seller.name}</p>
                    <p className="text-xs text-[var(--ink-dim)]">
                      {seller.role ? `${ROLE_LABEL[seller.role]} · ` : ""}
                      {CHANNEL_LABEL[order.channel]} · {paymentMethodLabel(order.payments)}
                    </p>
                  </td>
                  <td data-label="Comprador" className="px-4 py-3">
                    <p>{order.buyerName}</p>
                    <p className="text-xs text-[var(--ink-muted)]">{[order.buyerDocument && `CI ${order.buyerDocument}`, email].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td data-label="Qué compró" className="px-4 py-3">
                    <p>{session?.event.title}</p>
                    {global && session && <p className="text-xs font-medium text-[var(--ink-muted)]">{session.event.organization.name}</p>}
                    <p className="text-xs text-[var(--ink-muted)]">
                      {session && `${formatDateTime(session.startsAt, session.venue.timezone)} · `}
                      {order.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}
                    </p>
                  </td>
                  <td data-label="Total" className="px-4 py-3 text-right tabular-nums">
                    {formatMoney(order.totalAmount, order.currency)}
                    {order.discountAmount > 0 && (
                      <p className="text-xs text-[var(--ink-dim)]">
                        −{formatMoney(order.discountAmount, order.currency)}
                        {order.promoRedemption ? ` · ${order.promoRedemption.promoCode.code}` : ""}
                      </p>
                    )}
                    {order.discountAmount === 0 && order.promoRedemption && <p className="text-xs text-[var(--ink-dim)]">{order.promoRedemption.promoCode.code}</p>}
                  </td>
                  <td data-label="Estado" className="px-4 py-3">
                    <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.text}</span>
                    {refundPending && <p className="mt-1 text-xs font-medium text-[var(--danger)]">Reembolso pendiente</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {orders.length === 200 && (
          <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--ink-dim)]">
            Se muestran las 200 más recientes. Usa los filtros para encontrar una venta, o exporta a Excel para verlas todas.
          </p>
        )}
      </div>
    </div>
  );
}
