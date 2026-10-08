import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import QRCode from "qrcode";
import { MAX_TRANSFERS_PER_TICKET, code128Svg, formatCode, formatDateTime, signTicketPayload } from "@ticketera/core";
import { listCustomerTickets, listTransfers, requireEnv } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { acceptTransferAction, cancelTransferAction, declineTransferAction } from "./actions";
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
      qr: t.accessMethods.includes("QR")
        ? await QRCode.toString(await signTicketPayload(t.code, secret), { type: "svg", margin: 1, errorCorrectionLevel: "M" })
        : null,
      barcode: t.accessMethods.includes("BARCODE") ? code128Svg(t.code, { height: 56 }) : null,
    })),
  );

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{session.user.name}</p>
          <h1 className="font-display text-4xl">Mis entradas</h1>
        </div>
        <Link href="/mis-eventos" className="text-sm text-[var(--accent)] underline underline-offset-4">
          Ver mis compras
        </Link>
      </div>

      {aviso && (
        <p role="status" className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-3 text-sm">
          {aviso}
        </p>
      )}

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
          <Link href="/" className="text-[var(--accent)] underline underline-offset-4">
            Ver eventos
          </Link>
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {cards.map((t) => (
            <li key={t.id} className="rounded-2xl bg-[#f5f3ef] p-5 text-center text-[#14181b]">
              <p className="text-xs uppercase tracking-wide text-[#6b687a]">{t.receivedByTransfer ? "Recibida por transferencia" : "Entrada"}</p>
              <p className="font-display text-xl">{t.eventTitle}</p>
              <p className="text-xs text-[#6b687a]">
                {formatDateTime(t.startsAt, t.timezone)} · {t.venueName}
              </p>
              <p className="mt-1 font-semibold">{t.typeName}</p>
              {t.seat && <p className="text-sm font-semibold">{t.seat}</p>}
              {t.qr && <div className={`mx-auto my-3 w-44 ${t.status === "USED" ? "opacity-30" : ""}`} dangerouslySetInnerHTML={{ __html: t.qr }} />}
              {t.barcode && (
                <div className={`mx-auto my-3 w-full max-w-60 overflow-hidden rounded-md bg-white [&>svg]:h-auto [&>svg]:w-full ${t.status === "USED" ? "opacity-30" : ""}`} dangerouslySetInnerHTML={{ __html: t.barcode }} />
              )}
              {t.accessMethods.includes("NFC") && <p className="my-2 text-xs font-semibold text-[#6b687a]">{t.qr || t.barcode ? "También se lee por NFC." : "Se lee por NFC: acércala al lector."}</p>}
              <p className="font-mono text-sm tracking-wider">{formatCode(t.code)}</p>
              {t.status === "USED" && <p className="mt-1 text-xs font-semibold text-[#6b687a]">Ya utilizada</p>}

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
                  <p className="mt-3 text-xs text-[#6b687a]">{t.blockedReason}</p>
                ) : (
                  <details className="mt-3 rounded-lg border border-[#d8d5cc] p-3 text-left">
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
