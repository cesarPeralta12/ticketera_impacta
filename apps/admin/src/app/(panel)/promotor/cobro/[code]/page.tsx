import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import QRCode from "qrcode";
import { formatCode, formatDateTime, formatMoney, whatsappLink } from "@ticketera/core";
import { SIMULATED_PROVIDER, getOrderByCode } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { Countdown } from "@/components/countdown";
import { simulatePaymentAction } from "@/lib/actions/promoters";
import { simulatedPaymentsAllowed, ticketsMessage } from "@/lib/promoter-payments";
import { orderUrl } from "@/lib/qr";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Cobro por QR" };

/**
 * El cobro de una venta del promotor: el QR que el cliente paga desde su banco y, al pagarse, las entradas enviadas y
 * el botón para mandárselas por WhatsApp. La página se actualiza sola mientras espera el pago.
 */
export default async function PromoterChargePage({ params }: { params: Promise<{ code: string }> }) {
  await connection();
  const staff = await requireStaff(ROLES.promoter);
  const order = await getOrderByCode((await params).code.toUpperCase());
  if (!order || order.channel !== "PROMOTER" || order.promoterId !== staff.id) notFound();

  const session = order.items[0]?.ticketType.session;
  const now = new Date();
  const paid = order.status === "PAID" || order.status === "PARTIALLY_REFUNDED";
  const waiting = order.status === "PENDING_PAYMENT" && order.expiresAt > now;
  const payment = order.payments[0];
  const simulated = payment?.provider === SIMULATED_PROVIDER;
  // Con un banco conectado, el QR es el que devuelve su API; el de prueba no cobra nada (no lleva un enlace de pago).
  const qr = waiting
    ? await QRCode.toString(`iPass · cobro de prueba ${formatCode(order.code)} · ${formatMoney(order.totalAmount, order.currency)}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
    : null;
  const wa = paid && session ? whatsappLink(order.buyerPhone ?? "", ticketsMessage(order.buyerName, session.event.title, order.code)) : null;
  const tickets = order.tickets.filter((t) => t.status !== "CANCELLED").length;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {waiting && <AutoRefresh seconds={3} />}
      <div>
        <Link href="/promotor" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Mis eventos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{session?.event.title}</h1>
        {session && (
          <p className="text-sm capitalize text-[var(--ink-muted)]">
            {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name}
          </p>
        )}
      </div>

      <section className="card space-y-1 p-5 text-sm">
        <p className="flex justify-between gap-3">
          <span className="text-[var(--ink-muted)]">Cliente</span>
          <span className="font-medium">{order.buyerName}</span>
        </p>
        <p className="flex justify-between gap-3">
          <span className="text-[var(--ink-muted)]">Correo</span>
          <span>{order.buyerEmail}</span>
        </p>
        {order.items.map((item) => (
          <p key={item.id} className="flex justify-between gap-3">
            <span className="text-[var(--ink-muted)]">
              {item.quantity} × {item.name}
              {item.seat ? ` · ${item.seat.label}` : ""}
            </span>
            <span className="font-mono">{formatMoney(item.unitAmount * item.quantity, order.currency)}</span>
          </p>
        ))}
        <p className="flex justify-between gap-3 border-t border-[var(--border)] pt-2 text-base">
          <span className="font-semibold">Total</span>
          <span className="font-mono font-semibold">{formatMoney(order.totalAmount, order.currency)}</span>
        </p>
        <p className="flex justify-between gap-3 text-[var(--success)]">
          <span>Tu comisión</span>
          <span className="font-mono">{formatMoney(order.commissionAmount, order.currency)}</span>
        </p>
      </section>

      {waiting && qr && (
        <section className="card space-y-4 p-6 text-center">
          <p className="eyebrow">Que el cliente escanee este QR con la app de su banco</p>
          <div className="mx-auto w-64 max-w-full rounded-xl bg-white p-3 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="font-mono text-3xl font-semibold">{formatMoney(order.totalAmount, order.currency)}</p>
          <p className="text-sm text-[var(--ink-muted)]">
            Las entradas quedan reservadas por <Countdown until={order.expiresAt.toISOString()} />. Apenas paga, esta pantalla cambia sola.
          </p>
          {simulated && (
            <div className="space-y-3 rounded-lg border border-dashed border-[var(--warn)] bg-[var(--warn-soft)] p-4 text-left text-sm text-[var(--warn)]">
              <p>
                <strong>QR de prueba:</strong> todavía no hay un banco conectado, así que este QR no cobra nada. Cuando iPass conecte su banco o pasarela,
                aquí aparece el QR real y el pago se confirma solo.
              </p>
              {simulatedPaymentsAllowed() ? (
                <ActionForm action={simulatePaymentAction} confirm="¿Simular que el cliente pagó? (solo pruebas: no se cobra nada)">
                  <input type="hidden" name="code" value={order.code} />
                  <button type="submit" className="btn btn-primary px-4 py-2 text-sm">
                    Simular que el cliente pagó
                  </button>
                </ActionForm>
              ) : (
                <p>Mientras no haya banco conectado, el pago no se puede confirmar desde aquí.</p>
              )}
            </div>
          )}
        </section>
      )}

      {paid && (
        <section className="card space-y-4 border-[var(--success)] p-6 text-center">
          <p className="text-4xl" aria-hidden>
            ✓
          </p>
          <h2 className="text-xl font-semibold text-[var(--success)]">¡Pagado! Entradas emitidas</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            {tickets} entrada(s) enviadas a <strong>{order.buyerEmail}</strong>
            {order.ticketsEmailedAt ? "" : " (si no le llegan, que revise la carpeta de spam)"}. Tu comisión de{" "}
            <strong className="text-[var(--success)]">{formatMoney(order.commissionAmount, order.currency)}</strong> ya está sumada.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href={wa ?? `https://wa.me/?text=${encodeURIComponent(ticketsMessage(order.buyerName, session?.event.title ?? "", order.code))}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary px-4 py-2 text-sm"
            >
              Mandar por WhatsApp{order.buyerPhone ? ` (${order.buyerPhone})` : ""}
            </a>
            <a href={orderUrl(order.code)} target="_blank" rel="noreferrer" className="btn px-4 py-2 text-sm">
              Ver las entradas
            </a>
            {session && (
              <Link href={`/promotor/vender/${session.id}`} className="btn px-4 py-2 text-sm">
                Vender otra
              </Link>
            )}
          </div>
        </section>
      )}

      {!paid && !waiting && (
        <section className="card space-y-3 p-6 text-center">
          <h2 className="text-lg font-semibold">El cobro venció sin pagarse</h2>
          <p className="text-sm text-[var(--ink-muted)]">Las entradas se liberaron. Si el cliente todavía quiere comprar, haz la venta de nuevo.</p>
          {session && (
            <Link href={`/promotor/vender/${session.id}`} className="btn btn-primary px-4 py-2 text-sm">
              Volver a vender
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
