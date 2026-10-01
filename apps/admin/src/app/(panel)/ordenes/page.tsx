import type { Metadata } from "next";
import { connection } from "next/server";
import { formatCode, formatDateTime, formatMoney } from "@ticketera/core";
import { expireStaleOrders, prisma, type OrderStatus } from "@ticketera/db";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Órdenes" };

const statusLabel: Record<OrderStatus, { text: string; className: string }> = {
  PENDING_PAYMENT: { text: "Pendiente de pago", className: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  PAID: { text: "Pagada", className: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  EXPIRED: { text: "Expirada", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
  CANCELLED: { text: "Cancelada", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
  REFUNDED: { text: "Reembolsada", className: "bg-[var(--surface-2)] text-[var(--ink)]" },
  PARTIALLY_REFUNDED: { text: "Reembolso parcial", className: "bg-[var(--surface-2)] text-[var(--ink)]" },
};

export default async function OrdersPage() {
  await connection();
  await expireStaleOrders();
  const { organization: org } = await requireStaff(ROLES.manage);

  const orders = await prisma.order.findMany({
    where: { items: { some: { ticketType: { session: { event: { organizationId: org.id } } } } } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      items: { include: { ticketType: { include: { session: { include: { event: true, venue: true } } } } } },
      payments: { orderBy: { createdAt: "desc" } },
      _count: { select: { tickets: true } },
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Órdenes</h1>

      <div className="overflow-x-auto card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Orden</th>
              <th className="px-4 py-3 font-medium">Comprador</th>
              <th className="px-4 py-3 font-medium">Evento</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Pagos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--ink-muted)]">
                  Todavía no hay órdenes. Compra una entrada en el sitio público para verla aquí.
                </td>
              </tr>
            )}
            {orders.map((order) => {
              const session = order.items[0]?.ticketType.session;
              const approved = order.payments.filter((p) => p.status === "APPROVED").length;
              // Pago aprobado sin entradas que entregar, o pagado dos veces.
              const refundPending =
                (order.status === "EXPIRED" && approved > 0) || (order.status === "PAID" && approved > 1);
              const status = statusLabel[order.status];
              return (
                <tr key={order.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-mono">{formatCode(order.code)}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {session ? formatDateTime(order.createdAt, session.venue.timezone) : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{order.buyerName}</p>
                    <p className="text-xs text-[var(--ink-muted)]">{order.buyerEmail}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{session?.event.title}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {order.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}
                      {order._count.tickets > 0 && ` · ${order._count.tickets} entradas emitidas`}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(order.totalAmount, order.currency)}</td>
                  <td className="px-4 py-3">
                    <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${status.className}`}>
                      {status.text}
                    </span>
                    {refundPending && (
                      <p className="mt-1 text-xs font-medium text-[var(--danger)]">Reembolso pendiente</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--ink-muted)]">
                    {order.payments.length === 0
                      ? "—"
                      : order.payments.map((p) => (
                          <p key={p.id}>
                            {p.provider} · {p.status.toLowerCase()}
                          </p>
                        ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
