import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import QRCode from "qrcode";
import { code128Svg, entranceText, formatCode, formatDateTime, formatMoney, formatClock, gateInfo, reentryText, signTicketPayload, signVoucherPayload, tableLabel, usedTicketText, whenWhere, zonesText, type GateInfo } from "@ticketera/core";
import { BOX_OFFICE_BUYER, expireStaleOrders, getOrderByCode, requireEnv } from "@ticketera/db";
import { payOrderAction } from "./actions";
import { auth } from "@/lib/auth";
import { AutoRefresh, Countdown } from "./live";
import { ResendTickets } from "./resend-button";
import { DownloadTicketButton } from "@/components/ticket-image";
import { WhenWhereBlock } from "@/components/when-where";

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
  const guest = order.channel === "GUEST";
  // En boletería el email es opcional: si no lo dieron, no se muestra el de relleno.
  const email = order.buyerEmail && order.buyerEmail !== BOX_OFFICE_BUYER.email ? order.buyerEmail : null;
  const account = await auth();
  const isOwner = Boolean(account?.user?.id && account.user.id === order.customerId);
  const latestPayment = order.payments[0];
  const approvedPayments = order.payments.filter((p) => p.status === "APPROVED").length;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
      <header>
        <p className="eyebrow">
          {guest ? "Invitación" : "Orden"} {formatCode(order.code)}
        </p>
        <h1 className="font-display text-3xl sm:text-4xl">{session?.event.title}</h1>
        {session && (
          <p className="capitalize text-[var(--ink-muted)]">
            {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name}
          </p>
        )}
      </header>

      {session && order.status === "PAID" && <WhenWhereBlock data={whenWhere({ session, venue: session.venue, event: session.event })} />}

      {order.status === "PENDING_PAYMENT" && (
        <section className="space-y-4 rounded-xl border border-[var(--highlight)]/40 bg-[var(--highlight)]/10 p-5">
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
          {order.channel === "PROMOTER" ? (
            <p className="text-sm text-[var(--ink-muted)]">Tu promotor te muestra el QR para pagar con la app de tu banco. Apenas pagas, tus entradas llegan a tu correo.</p>
          ) : (
            <form action={payOrderAction}>
              <input type="hidden" name="code" value={order.code} />
              <button type="submit" className="btn-accent">
                {latestPayment ? "Pagar de nuevo" : "Pagar"} {formatMoney(order.totalAmount, order.currency)}
              </button>
            </form>
          )}
        </section>
      )}

      {order.status === "EXPIRED" && (
        <section className="space-y-2 rounded-xl border border-[var(--accent-2)]/40 bg-[var(--accent-2)]/10 p-5">
          <p className="font-semibold">Tu reserva venció y las entradas se liberaron.</p>
          {approvedPayments > 0 && (
            <p className="text-sm">Recibimos tu pago, pero ya no quedaban entradas disponibles. Te lo reembolsaremos.</p>
          )}
          {session && (
            <Link href={`/eventos/${session.event.slug}`} className="text-sm font-semibold text-[var(--accent-text)] underline">
              Volver a elegir entradas
            </Link>
          )}
        </section>
      )}

      {(order.status === "REFUNDED" || order.status === "CANCELLED") && (
        <section className="card p-5">
          <p className="font-semibold">
            {guest
              ? "Esta invitación fue anulada y ya no es válida."
              : `${order.status === "REFUNDED" ? "Esta orden fue reembolsada." : "Esta orden fue cancelada."} Las entradas ya no son válidas.`}
          </p>
        </section>
      )}

      {order.status === "PAID" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-[var(--green)]/40 bg-[var(--green)]/10 p-5">
            <p className="font-display text-xl text-[var(--green)]">
              {guest ? `¡${order.buyerName}, estás en la lista!` : order.channel === "POS" ? "Compra en boletería" : "¡Compra confirmada!"}
            </p>
            <p className="text-sm text-[var(--ink-muted)]">
              {guest
                ? "Presenta este QR en la puerta. Es personal y vale para un ingreso."
                : email && (order.channel === "ONLINE" || order.channel === "PROMOTER")
                  ? `Te enviamos las entradas a ${email}. Presenta el QR en la puerta.`
                  : order.tickets.every((t) => !reentryText(t.ticketType.maxEntries))
                    ? "Presenta el QR en la puerta. Cada entrada vale para un ingreso."
                    : "Presenta el QR en la puerta."}
            </p>
            {isOwner && order.channel === "ONLINE" && <ResendTickets code={order.code} />}
          </div>
          <TicketList
            tickets={order.tickets}
            guest={guest}
            ownerId={order.customerId}
            gates={(session?.venue.accessPoints ?? []).map(gateInfo)}
            timeZone={session?.venue.timezone ?? "America/La_Paz"}
            event={session ? { title: session.event.title, when: formatDateTime(session.startsAt, session.venue.timezone), venue: session.venue.name } : null}
          />
          {isOwner && order.channel === "ONLINE" && (
            <p className="text-sm text-[var(--ink-muted)]">
              ¿Quieres darle una entrada a otra persona?{" "}
              <Link href="/mis-entradas" className="text-[var(--accent-text)] underline underline-offset-4">
                Transferirla desde Mis entradas
              </Link>
              .
            </p>
          )}
        </section>
      )}

      {!guest && (
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
            {order.discountAmount > 0 && (
              <li className="flex justify-between px-5 py-3 text-[var(--green)]">
                <span>Descuento{order.promoRedemption ? ` (${order.promoRedemption.promoCode.code})` : ""}</span>
                <span className="tabular-nums">−{formatMoney(order.discountAmount, order.currency)}</span>
              </li>
            )}
            <li className="flex justify-between px-5 py-3 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(order.totalAmount, order.currency)}</span>
            </li>
          </ul>
          <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--ink-dim)]">
            {[order.buyerName, email].filter(Boolean).join(" · ")}
          </p>
        </section>
      )}
    </main>
  );
}

type TicketForList = {
  id: string;
  code: string;
  status: string;
  customerId: string | null;
  holderName: string | null;
  ticketType: {
    name: string;
    accessMethods: ("QR" | "BARCODE" | "NFC")[];
    qrMode: "STATIC" | "DYNAMIC";
    sectionId: string | null;
    kind: "ENTRY" | "TABLE";
    peoplePerUnit: number;
    entryUntil: Date | null;
    maxEntries: number;
    zones: { id: string; name: string }[];
  };
  seat: { label: string; section: { name: string } } | null;
  /** Boliche: mesa y saldo de consumo. */
  creditId: string | null;
  credit: { code: string; tableNumber: number | null; amount: number; currency: string; redeemedAt: Date | null; seat: { label: string } | null } | null;
  expiredAt: Date | null;
};

async function TicketList({
  tickets,
  guest,
  ownerId,
  gates,
  timeZone,
  event,
}: {
  tickets: TicketForList[];
  guest: boolean;
  ownerId: string | null;
  gates: GateInfo[];
  timeZone: string;
  /** Para la imagen descargable de cada entrada. */
  event: { title: string; when: string; venue: string } | null;
}) {
  // Persona N de M dentro de cada mesa.
  const seen = new Map<string, number>();
  const personOf = (ticket: TicketForList) => {
    if (!ticket.creditId || ticket.ticketType.kind !== "TABLE") return null;
    const n = (seen.get(ticket.creditId) ?? 0) + 1;
    seen.set(ticket.creditId, n);
    return n;
  };
  const secret = requireEnv("TICKET_QR_SECRET");
  const rendered = await Promise.all(
    tickets.map(async (ticket) => ({
      ...ticket,
      person: personOf(ticket),
      // Si la entrada se transfirió a otra cuenta, su QR ya no se muestra aquí (lo ve su nueva dueña en "Mis entradas").
      transferred: Boolean(ownerId && ticket.customerId && ticket.customerId !== ownerId),
      // Cada tipo de entrada define cómo se lee en puerta: se muestra solo lo que el lector admite.
      qr: !(ownerId && ticket.customerId && ticket.customerId !== ownerId) && ticket.ticketType.qrMode !== "DYNAMIC" && ticket.ticketType.accessMethods.includes("QR")
        ? await QRCode.toString(await signTicketPayload(ticket.code, secret), {
            type: "svg",
            margin: 1,
            errorCorrectionLevel: "M",
          })
        : null,
      barcode: !(ownerId && ticket.customerId && ticket.customerId !== ownerId) && ticket.ticketType.qrMode !== "DYNAMIC" && ticket.ticketType.accessMethods.includes("BARCODE") ? code128Svg(ticket.code, { height: 56 }) : null,
      dynamic: !(ownerId && ticket.customerId && ticket.customerId !== ownerId) && ticket.ticketType.qrMode === "DYNAMIC" && ticket.status === "VALID",
      nfc: ticket.ticketType.accessMethods.includes("NFC"),
    })),
  );

  // QR de consumo (uno por mesa o entrada con trago): se muestra en la barra, se lee una sola vez.
  const vouchers = await Promise.all(
    [...new Map(rendered.filter((t) => t.credit && t.credit.amount > 0 && !t.transferred).map((t) => [t.creditId, t])).values()].map(async (t) => ({
      id: t.creditId!,
      code: t.credit!.code,
      amount: t.credit!.amount,
      currency: t.credit!.currency,
      redeemedAt: t.credit!.redeemedAt,
      label: tableLabel(t.ticketType.name, t.credit!.tableNumber, t.credit!.seat?.label) ?? t.ticketType.name,
      qr: await QRCode.toString(await signVoucherPayload(t.credit!.code, secret), { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    })),
  );

  return (
    <>
    <ul className="grid gap-4 sm:grid-cols-2">
      {rendered.map((ticket, i) => (
        // Boleto claro: el QR se lee mejor con fondo blanco, también en pantallas con poco brillo.
        <li key={ticket.id} className="rounded-2xl bg-[#F5F6F8] p-5 text-center text-[#192438]">
          <p className="text-xs uppercase tracking-wide text-[#60718B]">
            {guest ? "Invitación" : `Entrada ${i + 1} de ${rendered.length}`}
          </p>
          {ticket.holderName && <p className="text-sm font-semibold">{ticket.holderName}</p>}
          <p className="font-display text-xl">{ticket.ticketType.name}</p>
          {ticket.seat && ticket.ticketType.kind !== "TABLE" && (
            <p className="text-sm font-semibold">
              {ticket.seat.section.name} · {ticket.seat.label}
            </p>
          )}
          {ticket.ticketType.kind === "TABLE" && ticket.credit && (
            <p className="text-sm font-semibold">
              {tableLabel(ticket.ticketType.name, ticket.credit.tableNumber, ticket.credit.seat?.label)}
              {ticket.person && ` · persona ${ticket.person} de ${ticket.ticketType.peoplePerUnit}`}
            </p>
          )}
          {ticket.ticketType.entryUntil && ticket.status === "VALID" && (
            <p className="mt-1 text-sm font-bold text-[#B77900]">Válida para entrar hasta las {formatClock(ticket.ticketType.entryUntil, timeZone)}</p>
          )}
          {ticket.credit && ticket.credit.amount > 0 && (!ticket.person || ticket.person === 1) && (
            <p className="mx-auto mt-2 w-fit rounded-full bg-[#192438] px-3 py-1 text-xs font-semibold text-[#F5B700]">
              Consumo {ticket.ticketType.kind === "TABLE" ? "de la mesa" : "incluido"}: {formatMoney(ticket.credit.amount, ticket.credit.currency)} · tu QR de consumo está abajo
            </p>
          )}
          {!ticket.transferred && entranceText(gates, ticket.ticketType.sectionId, ticket.ticketType.zones.map((z) => z.id)) && (
            <p className="mt-1 text-sm font-bold text-[#16846C]">
              {entranceText(gates, ticket.ticketType.sectionId, ticket.ticketType.zones.map((z) => z.id))}
            </p>
          )}
          {!ticket.transferred && zonesText(ticket.ticketType.zones.map((z) => z.name)) && (
            <p className="mt-1 text-sm font-bold text-[#192438]">{zonesText(ticket.ticketType.zones.map((z) => z.name))}</p>
          )}
          {!ticket.transferred && reentryText(ticket.ticketType.maxEntries) && (
            <p className="mt-1 text-xs text-[#60718B]">{reentryText(ticket.ticketType.maxEntries)}: al salir y al volver, haz leer tu QR en la puerta.</p>
          )}
          {ticket.transferred && (
            <p className="my-4 rounded-lg bg-[#fff4d6] px-3 py-3 text-sm font-semibold">Esta entrada fue transferida a otra persona.</p>
          )}
          {ticket.dynamic && (
            <div className="my-3">
              <Link href={`/entrada/${ticket.code}`} className="btn-accent inline-block">
                Abrir entrada (QR dinámico)
              </Link>
              <p className="mt-2 text-xs text-[#60718B]">Ábrela con internet antes de salir: el QR cambia cada 30 segundos y funciona sin señal.</p>
            </div>
          )}
          {ticket.qr && (
            <div
              className={`mx-auto my-3 w-48 ${ticket.status === "CANCELLED" ? "opacity-30" : ""}`}
              dangerouslySetInnerHTML={{ __html: ticket.qr }}
            />
          )}
          {ticket.barcode && (
            <div
              className={`mx-auto my-3 w-full max-w-60 overflow-hidden rounded-md bg-white [&>svg]:h-auto [&>svg]:w-full ${ticket.status === "CANCELLED" ? "opacity-30" : ""}`}
              dangerouslySetInnerHTML={{ __html: ticket.barcode }}
            />
          )}
          {ticket.nfc && (
            <p className="my-2 text-xs font-semibold text-[#60718B]">
              {ticket.qr || ticket.barcode ? "También se lee por NFC." : "Esta entrada se lee por NFC: acércala al lector."}
            </p>
          )}
          <p className="font-mono text-sm tracking-wider">{formatCode(ticket.code)}</p>
          {ticket.status === "USED" && <p className="mt-1 text-xs font-semibold text-[#60718B]">{usedTicketText(ticket.ticketType.maxEntries)}</p>}
          {event && (ticket.qr || ticket.barcode) && ticket.status !== "CANCELLED" && (
            <DownloadTicketButton
              ticket={{
                code: formatCode(ticket.code),
                eventTitle: event.title,
                when: event.when,
                venue: event.venue,
                holder: ticket.holderName,
                typeName: guest ? `Invitación · ${ticket.ticketType.name}` : ticket.ticketType.name,
                lines: [
                  entranceText(gates, ticket.ticketType.sectionId, ticket.ticketType.zones.map((z) => z.id)),
                  ticket.seat && ticket.ticketType.kind !== "TABLE" ? `${ticket.seat.section.name} · ${ticket.seat.label}` : null,
                  ticket.ticketType.kind === "TABLE" && ticket.credit ? tableLabel(ticket.ticketType.name, ticket.credit.tableNumber, ticket.credit.seat?.label) : null,
                  zonesText(ticket.ticketType.zones.map((z) => z.name)),
                  ticket.ticketType.entryUntil ? `Válida para entrar hasta las ${formatClock(ticket.ticketType.entryUntil, timeZone)}` : null,
                  reentryText(ticket.ticketType.maxEntries),
                ].filter((l): l is string => Boolean(l)),
                qrSvg: ticket.qr,
                barcodeSvg: ticket.barcode,
              }}
            />
          )}
          {ticket.status === "CANCELLED" && (
            <p className="mt-1 text-xs font-semibold text-[#C62842]">
              {ticket.expiredAt && ticket.ticketType.entryUntil
                ? `Venció: era válida para entrar hasta las ${formatClock(ticket.ticketType.entryUntil, timeZone)}`
                : "Anulada"}
            </p>
          )}
        </li>
      ))}
    </ul>
    {vouchers.length > 0 && (
      <section className="mt-6 space-y-3">
        <h2 className="font-display text-xl">QR de consumo</h2>
        <p className="text-sm text-[var(--ink-muted)]">
          Preséntalo en la barra: te dicen cuánto consumo tienes. Se lee <strong>una sola vez</strong>, así que no lo compartas ni lo captures.
        </p>
        <ul className="grid gap-4 sm:grid-cols-2">
          {vouchers.map((v) => (
            <li key={v.id} className="rounded-2xl bg-[#F5F6F8] p-5 text-center text-[#192438]">
              <p className="text-xs uppercase tracking-wide text-[#60718B]">QR de consumo</p>
              <p className="font-display text-xl">{v.label}</p>
              <p className="mt-1 text-lg font-bold text-[#16846C]">{formatMoney(v.amount, v.currency)}</p>
              <div className={`mx-auto my-3 w-48 ${v.redeemedAt ? "opacity-30" : ""}`} dangerouslySetInnerHTML={{ __html: v.qr }} />
              <p className="font-mono text-sm tracking-wider">{formatCode(v.code)}</p>
              <p className={`mt-1 text-xs font-semibold ${v.redeemedAt ? "text-[#C62842]" : "text-[#60718B]"}`}>
                {v.redeemedAt ? `Ya fue leído a las ${formatClock(v.redeemedAt, timeZone)}` : "Sin usar"}
              </p>
            </li>
          ))}
        </ul>
      </section>
    )}
    </>
  );
}
