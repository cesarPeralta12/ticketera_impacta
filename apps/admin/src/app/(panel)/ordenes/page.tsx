import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, formatCode, formatDateTime, formatMoney } from "@ticketera/core";
import { BOX_OFFICE_BUYER, expireStaleOrders, prisma, type OrderStatus, type Prisma } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { CHANNEL_LABEL } from "@/lib/labels";
import { ROLES, eventScope, isGlobalView, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ventas" };

const statusLabel: Record<OrderStatus, { text: string; className: string }> = {
  PENDING_PAYMENT: { text: "Pendiente de pago", className: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  PAID: { text: "Pagada", className: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  EXPIRED: { text: "Expirada", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
  CANCELLED: { text: "Cancelada", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
  REFUNDED: { text: "Reembolsada", className: "bg-[var(--surface-2)] text-[var(--ink)]" },
  PARTIALLY_REFUNDED: { text: "Reembolso parcial", className: "bg-[var(--surface-2)] text-[var(--ink)]" },
};

type Props = { searchParams: Promise<{ q?: string; estado?: string; org?: string }> };

/**
 * Compradores que van llegando. IMPACTA (vista general) ve los de todos los organizadores;
 * un organizador, solo los de sus eventos.
 */
export default async function SalesPage({ searchParams }: Props) {
  await connection();
  await expireStaleOrders();
  const staff = await requireStaff(ROLES.manage);
  const global = isGlobalView(staff);
  const { q = "", estado = "", org = "" } = await searchParams;
  const term = q.trim();

  const scope = eventScope(staff);
  const eventFilter: Prisma.EventWhereInput = global && org ? { organizationId: org } : scope;
  const where: Prisma.OrderWhereInput = {
    items: { some: { ticketType: { session: { event: eventFilter } } } },
    ...(estado in statusLabel ? { status: estado as OrderStatus } : {}),
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

  const [orders, organizers, totals] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        items: {
          include: {
            ticketType: { include: { session: { include: { event: { include: { organization: true } }, venue: true } } } },
          },
        },
        payments: { orderBy: { createdAt: "desc" } },
        _count: { select: { tickets: true } },
      },
    }),
    global ? prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    prisma.order.aggregate({ where: { ...where, status: "PAID" }, _sum: { totalAmount: true }, _count: true }),
  ]);

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} />
      <div>
        <p className="eyebrow">{global ? "Todos los organizadores" : staff.organization.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Ventas</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Cada compra: quién compró, qué, cuánto y por qué canal. Se actualiza cada 30 segundos.{" "}
          <span className="font-medium text-[var(--ink)]">
            {totals._count} pagada(s) · {formatMoney(totals._sum.totalAmount ?? 0, staff.organization.currency)}
          </span>{" "}
          {term || estado || org ? "con estos filtros" : "en total"}.
        </p>
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4">
        <label className="label min-w-56 flex-1">
          Buscar
          <input name="q" defaultValue={q} placeholder="Nombre, email, CI o código de orden" className="field" />
        </label>
        <label className="label">
          Estado
          <select name="estado" defaultValue={estado} className="field">
            <option value="">Todos</option>
            {Object.entries(statusLabel).map(([value, s]) => (
              <option key={value} value={value}>
                {s.text}
              </option>
            ))}
          </select>
        </label>
        {global && (
          <label className="label">
            Organizador
            <select name="org" defaultValue={org} className="field">
              <option value="">Todos</option>
              {organizers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="btn">
          Filtrar
        </button>
        {(term || estado || org) && (
          <Link href="/ordenes" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
            Limpiar
          </Link>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="eyebrow border-b border-[var(--border)]">
            <tr>
              <th className="px-4 py-3 font-normal">Orden</th>
              <th className="px-4 py-3 font-normal">Comprador</th>
              <th className="px-4 py-3 font-normal">Evento</th>
              <th className="px-4 py-3 text-right font-normal">Total</th>
              <th className="px-4 py-3 font-normal">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {orders.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--ink-muted)]">
                  {term || estado || org ? "Ninguna compra con estos filtros." : "Todavía no hay compras."}
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
              return (
                <tr key={order.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-mono">{formatCode(order.code)}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {formatDateTime(order.createdAt, session?.venue.timezone ?? DEFAULT_TIMEZONE)}
                    </p>
                    <p className="text-xs text-[var(--ink-dim)]">{CHANNEL_LABEL[order.channel]}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{order.buyerName}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {[email, order.buyerDocument && `CI ${order.buyerDocument}`].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{session?.event.title}</p>
                    {global && session && <p className="text-xs font-medium text-[var(--ink-muted)]">{session.event.organization.name}</p>}
                    <p className="text-xs text-[var(--ink-muted)]">
                      {order.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}
                      {order._count.tickets > 0 && ` · ${order._count.tickets} entrada(s)`}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(order.totalAmount, order.currency)}</td>
                  <td className="px-4 py-3">
                    <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${status.className}`}>
                      {status.text}
                    </span>
                    {refundPending && <p className="mt-1 text-xs font-medium text-[var(--danger)]">Reembolso pendiente</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {orders.length === 200 && (
          <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--ink-dim)]">
            Se muestran las 200 más recientes. Usa el buscador o los filtros para encontrar una compra.
          </p>
        )}
      </div>
    </div>
  );
}
