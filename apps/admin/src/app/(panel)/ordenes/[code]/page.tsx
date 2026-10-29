import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, formatCode, formatDateTime, formatMoney } from "@ticketera/core";
import { BOX_OFFICE_BUYER, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { voidOrderAction } from "@/lib/actions/orders";
import { CHANNEL_LABEL, ROLE_LABEL } from "@/lib/labels";
import { paymentMethodLabel, sellerOf } from "@/lib/sales";
import { ROLES, eventScope, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Venta" };

const STATUS: Record<string, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagada",
  EXPIRED: "Expirada",
  CANCELLED: "Anulada",
  REFUNDED: "Devuelta",
  PARTIALLY_REFUNDED: "Reembolso parcial",
};
const TICKET_STATUS: Record<string, string> = { VALID: "Válida", USED: "Usada", CANCELLED: "Anulada" };
const PAYMENT_STATUS: Record<string, string> = { PENDING: "Pendiente", APPROVED: "Aprobado", REJECTED: "Rechazado", CANCELLED: "Cancelado", REFUNDED: "Devuelto", CHARGED_BACK: "Contracargo" };

/**
 * Una venta con todo su detalle: quién la vendió y por qué medio, el comprador, qué compró, los importes, el código y
 * la comisión, los pagos con su referencia y las entradas. Un administrador de iPass puede anularla o registrar su
 * devolución, con motivo.
 */
export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const code = (await params).code.replace(/[\s-]/g, "").toUpperCase();
  const order = await prisma.order.findFirst({
    where: { code, items: { some: { ticketType: { session: { event: eventScope(staff) } } } } },
    include: {
      issuedBy: { select: { name: true, memberships: { select: { role: true, organizationId: true } } } },
      promoter: { select: { id: true, name: true } },
      voidedBy: { select: { name: true } },
      commissionPayout: { select: { createdAt: true } },
      payments: { orderBy: { createdAt: "desc" } },
      promoRedemption: { include: { promoCode: { select: { code: true, promoterName: true } } } },
      items: { include: { ticketType: { include: { session: { include: { event: true, venue: { select: { name: true, timezone: true } } } } } }, seat: true } },
      tickets: { orderBy: { issuedAt: "asc" }, select: { id: true, code: true, status: true, entries: true, holderName: true, ticketType: { select: { name: true } } } },
    },
  });
  if (!order) notFound();
  const session = order.items[0]?.ticketType.session;
  const tz = session?.venue.timezone ?? DEFAULT_TIMEZONE;
  const seller = sellerOf(order);
  const money = (c: number) => formatMoney(c, order.currency);
  const used = order.tickets.some((t) => t.status === "USED" || t.entries > 0);
  const canVoid = !staff.readOnly && order.status === "PAID" && order.channel !== "GUEST" && order.channel !== "PRINTED";
  const email = order.buyerEmail === BOX_OFFICE_BUYER.email ? null : order.buyerEmail;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/ordenes" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Ventas
        </Link>
        <p className="eyebrow mt-2">Venta {formatCode(order.code)}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{order.buyerName}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {STATUS[order.status] ?? order.status} · {CHANNEL_LABEL[order.channel]} · {formatDateTime(order.createdAt, tz)}
        </p>
      </div>

      {order.voidedAt && (
        <p role="status" className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
          {order.status === "REFUNDED" ? "Devuelta" : "Anulada"} el {formatDateTime(order.voidedAt, tz)} por {order.voidedBy?.name ?? "—"}. Motivo: {order.voidReason}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card space-y-1.5 p-5 text-sm">
          <h2 className="eyebrow mb-2">Quién y cómo</h2>
          <p>
            <span className="text-[var(--ink-muted)]">Vendedor:</span> {seller.name}
            {seller.role && <span className="text-[var(--ink-dim)]"> · {ROLE_LABEL[seller.role]}</span>}
          </p>
          <p>
            <span className="text-[var(--ink-muted)]">Medio:</span> {paymentMethodLabel(order.payments)}
          </p>
          {order.promoter && (
            <p>
              <span className="text-[var(--ink-muted)]">Promotor:</span>{" "}
              <Link href={`/promotores/${order.promoter.id}`} className="underline">
                {order.promoter.name}
              </Link>{" "}
              · comisión {money(order.commissionAmount)}
              {order.commissionPayout ? ` (liquidada el ${formatDateTime(order.commissionPayout.createdAt, tz)})` : order.status === "PAID" ? " (por pagar)" : ""}
            </p>
          )}
          {order.paidAt && (
            <p>
              <span className="text-[var(--ink-muted)]">Pagada:</span> {formatDateTime(order.paidAt, tz)}
            </p>
          )}
        </section>

        <section className="card space-y-1.5 p-5 text-sm">
          <h2 className="eyebrow mb-2">Comprador</h2>
          <p className="font-medium">{order.buyerName}</p>
          {order.buyerDocument && <p>CI {order.buyerDocument}</p>}
          {email && <p>{email}</p>}
          {order.buyerPhone && <p>WhatsApp {order.buyerPhone}</p>}
        </section>
      </div>

      <section className="card p-5 text-sm">
        <h2 className="eyebrow mb-2">Qué compró</h2>
        {session && (
          <p className="mb-2">
            <span className="font-medium">{session.event.title}</span> · {formatDateTime(session.startsAt, tz)} · {session.venue.name}
          </p>
        )}
        <ul className="divide-y divide-[var(--border)]">
          {order.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3 py-1.5">
              <span>
                {i.quantity} × {i.name}
                {i.seat ? ` · ${i.seat.label}` : ""}
              </span>
              <span className="font-mono">{money(i.unitAmount * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
          {order.discountAmount > 0 && (
            <p className="flex justify-between">
              <span className="text-[var(--ink-muted)]">Descuento{order.promoRedemption ? ` (código ${order.promoRedemption.promoCode.code})` : ""}</span>
              <span className="font-mono">−{money(order.discountAmount)}</span>
            </p>
          )}
          {order.discountAmount === 0 && order.promoRedemption && (
            <p className="flex justify-between">
              <span className="text-[var(--ink-muted)]">Código usado</span>
              <span className="font-mono">{order.promoRedemption.promoCode.code}</span>
            </p>
          )}
          <p className="flex justify-between text-base font-semibold">
            <span>Total cobrado</span>
            <span className="font-mono">{money(order.totalAmount)}</span>
          </p>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card p-5 text-sm">
          <h2 className="eyebrow mb-2">Pagos</h2>
          {order.payments.length === 0 ? (
            <p className="text-[var(--ink-muted)]">Sin pagos (invitación, impresa o importada).</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {order.payments.map((p) => (
                <li key={p.id} className="py-1.5">
                  <span className="font-medium">{paymentMethodLabel([p])}</span> · {PAYMENT_STATUS[p.status] ?? p.status} · <span className="font-mono">{money(p.amount)}</span>
                  <span className="block text-xs text-[var(--ink-dim)]">
                    Ref. {p.providerPaymentId ?? "—"} · {formatDateTime(p.approvedAt ?? p.createdAt, tz)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5 text-sm">
          <h2 className="eyebrow mb-2">Entradas</h2>
          {order.tickets.length === 0 ? (
            <p className="text-[var(--ink-muted)]">Todavía no se emitieron.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {order.tickets.map((t) => (
                <li key={t.id} className="flex justify-between gap-3 py-1.5">
                  <Link href={`/entradas/${t.code}`} className="font-mono hover:underline">
                    {formatCode(t.code)}
                  </Link>
                  <span className="text-[var(--ink-muted)]">
                    {t.ticketType.name} · {TICKET_STATUS[t.status] ?? t.status}
                    {t.entries > 1 ? ` (${t.entries} ingresos)` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canVoid && (
        <section className="card space-y-3 border-[var(--danger)]/40 p-5" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, var(--border))" }}>
          <h2 className="eyebrow text-[var(--danger)]">Anular o devolver</h2>
          {used ? (
            <p className="text-sm text-[var(--ink-muted)]">Alguna entrada ya se usó en la puerta: esta venta no se puede anular.</p>
          ) : (
            <ActionForm action={voidOrderAction} confirm="¿Seguro? Las entradas dejan de valer y no se puede deshacer." className="space-y-3">
              <input type="hidden" name="code" value={order.code} />
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="kind" value="void" defaultChecked className="accent-[var(--accent)]" /> Anular (la venta no debió existir)
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="kind" value="refund" className="accent-[var(--accent)]" /> Devolución (se le devolvió el dinero)
                </label>
              </fieldset>
              <label className="label">
                Motivo (queda en el registro de seguridad)
                <textarea name="reason" required minLength={5} maxLength={500} rows={2} className="field" />
              </label>
              <button type="submit" className="btn text-[var(--danger)]">
                Anular las entradas
              </button>
              <p className="text-xs text-[var(--ink-dim)]">
                Las entradas dejan de valer y su lugar vuelve a la venta. Con una pasarela conectada, la devolución del dinero se hace también en el banco;
                hoy se registra que se devolvió por fuera.{order.commissionPayoutId ? " La comisión de esta venta ya se le pagó al promotor." : ""}
              </p>
            </ActionForm>
          )}
        </section>
      )}
    </div>
  );
}
