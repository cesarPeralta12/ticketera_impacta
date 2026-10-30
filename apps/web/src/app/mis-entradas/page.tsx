import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import QRCode from "qrcode";
import { MAX_TRANSFERS_PER_TICKET, code128Svg, formatCode, formatDateTime, formatMoney, formatClock, reentryText, signTicketPayload, usedTicketText } from "@ticketera/core";
import { listCustomerTickets, listTransfers, requireEnv } from "@ticketera/db";
import { DownloadTicketButton } from "@/components/ticket-image";
import { auth } from "@/lib/auth";
import { acceptTransferAction, cancelTransferAction, declineTransferAction } from "./actions";
import { OfflineReady } from "./offline-ready";
import { TransferForm } from "./transfer-form";

export const metadata: Metadata = { title: "Mis entradas", robots: { index: false } };

type Props = { searchParams: Promise<{ aviso?: string }> };

/** Las entradas que tengo ahora (compradas o recibidas): QR, estado y transferencia a otra persona. */
export default async function MyTicketsPage({ searchParams }: Props) {
  await connection();
  const { aviso } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/mis-entradas");

  const [tickets, transfers] = await Promise.all([listCustomerTickets(session.user.id), listTransfers(session.user.id)]);
  const secret = requireEnv("TICKET_QR_SECRET");
  const cards = await Promise.all(
    tickets.map(async (t) => ({
      ...t,
      // Una entrada de QR dinámico no lleva QR fijo: se abre en su propia página, donde el QR cambia cada 30 s.
      qr:
        t.qrMode !== "DYNAMIC" && t.accessMethods.includes("QR")
          ? await QRCode.toString(await signTicketPayload(t.code, secret), { type: "svg", margin: 1, errorCorrectionLevel: "M" })
          : null,
      barcode: t.qrMode !== "DYNAMIC" && t.accessMethods.includes("BARCODE") ? code128Svg(t.code, { height: 56 }) : null,
    })),
  );
  const dynamicCodes = cards.filter((t) => t.qrMode === "DYNAMIC" && t.status === "VALID").map((t) => t.code);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{session.user.name}</p>
          <h1 className="font-display text-4xl">Mis entradas</h1>
        </div>
        <Link href="/mis-eventos" className="text-sm text-[var(--accent-text)] underline underline-offset-4">
          Ver mis compras
        </Link>
      </div>

      {aviso && (
        <p role="status" className="rounded-xl border border-[var(--highlight)]/40 bg-[var(--highlight)]/10 px-4 py-3 text-sm">
          {aviso}
        </p>
      )}

      {dynamicCodes.length > 0 && <OfflineReady userId={session.user.id} codes={dynamicCodes} />}

      {transfers.incoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-xl">Te ofrecieron entradas</h2>
          <ul className="space-y-3">
            {transfers.incoming.map((t) => (
              <li key={t.id} className="card space-y-3 p-5">
                <p>
                  <strong>{t.fromName}</strong> quiere transferirte una entrada:
                </p>
                <div>
                  <p className="font-display text-lg">{t.eventTitle}</p>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {formatDateTime(t.startsAt, t.timezone)} · {t.venueName}
                  </p>
                  <p className="text-sm font-semibold">
                    {t.typeName}
                    {t.seat ? ` · ${t.seat}` : ""}
                  </p>
                </div>
                <p className="text-xs text-[var(--ink-dim)]">
                  Si la aceptas pasa a tu cuenta con tu nombre y tu carnet, y su QR anterior deja de valer. Vence el{" "}
                  {formatDateTime(t.expiresAt, t.timezone)}.
                </p>
                <div className="flex flex-wrap gap-3">
                  <form action={acceptTransferAction}>
                    <input type="hidden" name="transferId" value={t.id} />
                    <button type="submit" className="btn-accent">
                      Aceptar la entrada
                    </button>
                  </form>
                  <form action={declineTransferAction}>
                    <input type="hidden" name="transferId" value={t.id} />
                    <button type="submit" className="rounded-full border border-[var(--border-light)] px-5 py-2 text-sm font-semibold hover:bg-white/5">
                      Rechazar
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cards.length === 0 ? (
        <p className="text-[var(--ink-muted)]">
          Todavía no tienes entradas con esta cuenta.{" "}
          <Link href="/" className="text-[var(--accent-text)] underline underline-offset-4">
            Ver eventos
          </Link>
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {cards.map((t) => (
            <li key={t.id} className="rounded-2xl bg-[#F5F6F8] p-5 text-center text-[#192438]">
              <p className="text-xs uppercase tracking-wide text-[#60718B]">{t.receivedByTransfer ? "Recibida por transferencia" : "Entrada"}</p>
              <p className="font-display text-xl">{t.eventTitle}</p>
              <p className="text-xs text-[#60718B]">
                {formatDateTime(t.startsAt, t.timezone)} · {t.venueName}
              </p>
              {(t.whenWhere.when.doors || t.whenWhere.when.end) && (
                <p className="text-xs text-[#60718B]">
                  {[t.whenWhere.when.doors, t.whenWhere.when.lastEntry, t.whenWhere.when.end].filter(Boolean).join(" · ")}
                </p>
              )}
              {t.whenWhere.conditions.length > 0 && <p className="text-xs font-semibold text-[#B77900]">{t.whenWhere.conditions.slice(0, 2).join(" · ")}</p>}
              {t.whenWhere.place.mapUrl && (
                <a href={t.whenWhere.place.mapUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[#16846C] underline">
                  Cómo llegar
                </a>
              )}
              <p className="mt-1 font-semibold">{t.typeName}</p>
              {t.seat && <p className="text-sm font-semibold">{t.seat}</p>}
              {t.entrance && <p className="mt-1 text-sm font-bold text-[#16846C]">{t.entrance}</p>}
              {t.entryUntil && t.status === "VALID" && (
                <p className="mt-1 text-sm font-bold text-[#B77900]">Válida para entrar hasta las {formatClock(t.entryUntil, t.timezone)}</p>
              )}
              {t.consumption && (
                <p className="mx-auto mt-2 w-fit rounded-full bg-[#192438] px-3 py-1 text-xs font-semibold text-[#F5B700]">
                  Consumo {t.consumption.shared ? "de la mesa" : "incluido"}: te quedan {formatMoney(t.consumption.left, t.consumption.currency)} de{" "}
                  {formatMoney(t.consumption.amount, t.consumption.currency)}
                </p>
              )}
              {t.qrMode === "DYNAMIC" && (
                <div className="my-3">
                  <Link href={`/entrada/${t.code}`} className="btn-accent inline-block">
                    Abrir entrada (QR dinámico)
                  </Link>
                  <p className="mt-2 text-xs text-[#60718B]">El QR cambia cada 30 segundos y funciona sin internet. No sirve una captura.</p>
                </div>
              )}
              {/* Siempre nítido: con reingreso, una entrada ya leída se vuelve a leer al salir y al volver. */}
              {t.qr && <div className="mx-auto my-3 w-44" dangerouslySetInnerHTML={{ __html: t.qr }} />}
              {t.barcode && (
                <div className="mx-auto my-3 w-full max-w-60 overflow-hidden rounded-md bg-white [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: t.barcode }} />
              )}
              {t.accessMethods.includes("NFC") && <p className="my-2 text-xs font-semibold text-[#60718B]">{t.qr || t.barcode ? "También se lee por NFC." : "Se lee por NFC: acércala al lector."}</p>}
              <p className="font-mono text-sm tracking-wider">{formatCode(t.code)}</p>
              {t.status === "USED" && <p className="mt-1 text-xs font-semibold text-[#60718B]">{usedTicketText(t.maxEntries)}</p>}
              {(t.qr || t.barcode) && (
                <DownloadTicketButton
                  ticket={{
                    code: formatCode(t.code),
                    eventTitle: t.eventTitle,
                    when: formatDateTime(t.startsAt, t.timezone),
                    venue: t.venueName,
                    holder: t.holderName,
                    typeName: t.typeName,
                    lines: [
                      t.entrance,
                      t.seat,
                      t.entryUntil ? `Válida para entrar hasta las ${formatClock(t.entryUntil, t.timezone)}` : null,
                      reentryText(t.maxEntries),
                    ].filter((l): l is string => Boolean(l)),
                    qrSvg: t.qr,
                    barcodeSvg: t.barcode,
                  }}
                />
              )}

              {t.pending ? (
                <div className="mt-3 rounded-lg bg-[#fff4d6] p-3 text-left text-xs">
                  <p>
                    Ofrecida a <strong>{t.pending.toName}</strong>: esperando que la acepte.
                  </p>
                  <form action={cancelTransferAction} className="mt-2">
                    <input type="hidden" name="transferId" value={t.pending.id} />
                    <button type="submit" className="font-semibold underline">
                      Cancelar la oferta
                    </button>
                  </form>
                </div>
              ) : t.status === "VALID" ? (
                t.blockedReason ? (
                  <p className="mt-3 text-xs text-[#60718B]">{t.blockedReason}</p>
                ) : (
                  <details className="mt-3 rounded-lg border border-[#E6EAF0] p-3 text-left">
                    <summary className="cursor-pointer text-sm font-semibold">Transferir a otra persona</summary>
                    <TransferForm ticketId={t.id} />
                  </details>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {cards.length > 0 && (
        <p className="text-xs text-[var(--ink-dim)]">
          Cada entrada se puede transferir hasta {MAX_TRANSFERS_PER_TICKET} veces y hasta pocas horas antes de la función. Lleva siempre tu carnet: es a tu nombre.
        </p>
      )}
    </main>
  );
}
