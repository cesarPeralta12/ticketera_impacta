import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import QRCode from "qrcode";
import { formatCode, formatDateTime, formatMoney, signTicketPayload } from "@ticketera/core";
import { expireStaleOrders, getOrderByCode, requireEnv } from "@ticketera/db";
import { payOrderAction } from "./actions";
import { AutoRefresh, Countdown } from "./live";

export const metadata: Metadata = { title: "Tu orden", robots: { index: false } };

type Props = { params: Promise<{ code: string }> };

/** Un pago iniciado hace menos de 5 minutos puede estar esperando el webhook de la pasarela. */
function isAwaitingWebhook(payment: { status: string; createdAt: Date } | undefined) {
  return payment?.status === "PENDING" && Date.now() - payment.createdAt.getTime() < 5 * 60_000;
}

export default async function OrderPage({ params }: Props) {
  await connection();
  await expireStaleOrders();
  const order = await getOrderByCode((await params).code.toUpperCase());
  if (!order) notFound();

  const session = order.items[0]?.ticketType.session;
  const latestPayment = order.payments[0];
  const approvedPayments = order.payments.filter((p) => p.status === "APPROVED").length;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
      <header>
        <p className="eyebrow">Orden {formatCode(order.code)}</p>
        <h1 className="font-display text-3xl sm:text-4xl">{session?.event.title}</h1>
        {session && (
          <p className="capitalize text-[var(--ink-muted)]">
            {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name}
          </p>
        )}
      </header>

      {order.status === "PENDING_PAYMENT" && (
        <section className="space-y-4 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-5">
          {isAwaitingWebhook(latestPayment) ? (
            <>
              <AutoRefresh />
              <p className="font-semibold">Estamos confirmando tu pago con la pasarela…</p>
              <p className="text-sm text-[var(--ink-muted)]">Esta página se actualiza sola. No la cierres.</p>
            </>
          ) : (
            <p className="font-semibold">
              {latestPayment?.status === "REJECTED"
                ? "Tu pago fue rechazado. Puedes intentarlo de nuevo."
                : "Tus entradas están reservadas. Completa el pago para confirmarlas."}
            </p>
          )}
          <p className="text-sm">
            La reserva vence en <Countdown expiresAt={order.expiresAt.toISOString()} />
          </p>
          <form action={payOrderAction}>
            <input type="hidden" name="code" value={order.code} />
            <button type="submit" className="btn-accent">
              {latestPayment ? "Pagar de nuevo" : "Pagar"} {formatMoney(order.totalAmount, order.currency)}
            </button>
          </form>
        </section>
      )}

      {order.status === "EXPIRED" && (
        <section className="space-y-2 rounded-xl border border-[var(--accent-2)]/40 bg-[var(--accent-2)]/10 p-5">
          <p className="font-semibold">Tu reserva venció y las entradas se liberaron.</p>
          {approvedPayments > 0 && (
            <p className="text-sm">Recibimos tu pago, pero ya no quedaban entradas disponibles. Te lo reembolsaremos.</p>
          )}
          {session && (
            <Link href={`/eventos/${session.event.slug}`} className="text-sm font-semibold text-[var(--accent)] underline">
              Volver a elegir entradas
            </Link>
          )}
        </section>
      )}

      {(order.status === "REFUNDED" || order.status === "CANCELLED") && (
        <section className="card p-5">
          <p className="font-semibold">
            {order.status === "REFUNDED" ? "Esta orden fue reembolsada." : "Esta orden fue cancelada."} Las entradas ya no
            son válidas.
          </p>
        </section>
      )}

      {order.status === "PAID" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-[var(--green)]/40 bg-[var(--green)]/10 p-5">
            <p className="font-display text-xl text-[var(--green)]">¡Compra confirmada!</p>
            <p className="text-sm text-[var(--ink-muted)]">
              Te enviamos las entradas a {order.buyerEmail}. Presenta el QR en la puerta.
            </p>
          </div>
          <TicketList tickets={order.tickets} />
        </section>
      )}

      <section className="card">
        <h2 className="border-b border-[var(--border)] px-5 py-3 font-display text-lg">Resumen</h2>
        <ul className="divide-y divide-[var(--border)] text-sm">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between px-5 py-3">
              <span>
                {item.quantity} × {item.name}
                {item.seat && <span className="text-[var(--ink-dim)]"> · {item.seat.label}</span>}
              </span>
              <span className="tabular-nums">{formatMoney(item.unitAmount * item.quantity, order.currency)}</span>
            </li>
          ))}
          <li className="flex justify-between px-5 py-3 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(order.totalAmount, order.currency)}</span>
          </li>
        </ul>
        <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--ink-dim)]">
          {order.buyerName} · {order.buyerEmail}
        </p>
      </section>
    </main>
  );
}

type TicketForList = {
  id: string;
  code: string;
  status: string;
  ticketType: { name: string };
  seat: { label: string; section: { name: string } } | null;
};

async function TicketList({ tickets }: { tickets: TicketForList[] }) {
  const secret = requireEnv("TICKET_QR_SECRET");
  const rendered = await Promise.all(
    tickets.map(async (ticket) => ({
      ...ticket,
      qr: await QRCode.toString(await signTicketPayload(ticket.code, secret), {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
      }),
    })),
  );

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {rendered.map((ticket, i) => (
        // Boleto claro: el QR se lee mejor con fondo blanco, también en pantallas con poco brillo.
        <li key={ticket.id} className="rounded-2xl bg-[#f5f3ef] p-5 text-center text-[#14181b]">
          <p className="text-xs uppercase tracking-wide text-[#6b687a]">
            Entrada {i + 1} de {rendered.length}
          </p>
          <p className="font-display text-xl">{ticket.ticketType.name}</p>
          {ticket.seat && (
            <p className="text-sm font-semibold">
              {ticket.seat.section.name} · {ticket.seat.label}
            </p>
          )}
          <div
            className={`mx-auto my-3 w-48 ${ticket.status === "VALID" ? "" : "opacity-30"}`}
            dangerouslySetInnerHTML={{ __html: ticket.qr }}
          />
          <p className="font-mono text-sm tracking-wider">{formatCode(ticket.code)}</p>
          {ticket.status === "USED" && <p className="mt-1 text-xs font-semibold text-[#6b687a]">Ya utilizada</p>}
          {ticket.status === "CANCELLED" && <p className="mt-1 text-xs font-semibold text-[#c2183e]">Anulada</p>}
        </li>
      ))}
    </ul>
  );
}
