import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import QRCode from "qrcode";
import {
  MAX_TRANSFERS_PER_TICKET,
  canDownloadTicketImage,
  canDownloadVoucherImage,
  code128Svg,
  formatClock,
  formatCode,
  formatDateTime,
  formatMoney,
  isPastNight,
  reentryText,
  signTicketPayload,
  signVoucherPayload,
  usedTicketText,
  utcToZonedInput,
} from "@ticketera/core";
import { listCustomerTickets, listCustomerVouchers, listTransfers, requireEnv } from "@ticketera/db";
import { DownloadTicketButton } from "@/components/ticket-image";
import { auth } from "@/lib/auth";
import { acceptTransferAction, cancelTransferAction, declineTransferAction } from "./actions";
import { TicketFilters } from "./filters";
import { OfflineReady } from "./offline-ready";
import { TransferForm } from "./transfer-form";

export const metadata: Metadata = { title: "Mis entradas", robots: { index: false } };

type Props = { searchParams: Promise<{ aviso?: string; q?: string; dia?: string; tipo?: string; estado?: string; ver?: string }> };

/** Para buscar sin importar mayúsculas ni tildes. */
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Mis entradas: las entradas y los QR de consumo que tengo, ordenados por función. Lo que todavía vale se ve con su QR;
 * cuando la función ya pasó, el QR se va y queda en «Pasadas» como historial. Se puede buscar y filtrar por día, por
 * entradas o consumo y por usadas o sin usar.
 */
export default async function MyTicketsPage({ searchParams }: Props) {
  await connection();
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/mis-entradas");

  const now = new Date();
  const [tickets, vouchers, transfers] = await Promise.all([listCustomerTickets(session.user.id), listCustomerVouchers(session.user.id), listTransfers(session.user.id)]);
  const secret = requireEnv("TICKET_QR_SECRET");

  const q = (sp.q ?? "").trim();
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(sp.dia ?? "") ? sp.dia! : "";
  const tipo = sp.tipo === "entradas" || sp.tipo === "consumo" ? sp.tipo : "";
  const estado = sp.estado === "sin-usar" || sp.estado === "usadas" ? sp.estado : "";
  const ver = sp.ver === "pasadas" ? "pasadas" : "proximas";

  // Cada función con lo que tengo en ella: entradas y QR de consumo.
  type Entry = (typeof tickets)[number];
  type Voucher = (typeof vouchers)[number];
  type Night = { key: string; startsAt: Date; timezone: string; eventTitle: string; venueName: string; past: boolean; entries: Entry[]; vouchers: Voucher[] };
  const nights = new Map<string, Night>();
  const nightOf = (x: { sessionId: string; startsAt: Date; endsAt: Date | null; timezone: string; eventTitle: string; venueName: string }) => {
    let n = nights.get(x.sessionId);
    if (!n) {
      n = { key: x.sessionId, startsAt: x.startsAt, timezone: x.timezone, eventTitle: x.eventTitle, venueName: x.venueName, past: isPastNight(x.startsAt, x.endsAt, now), entries: [], vouchers: [] };
      nights.set(x.sessionId, n);
    }
    return n;
  };

  const needle = plain(q);
  const dayOf = (startsAt: Date, timezone: string) => utcToZonedInput(startsAt, timezone).slice(0, 10);
  const matches = (parts: (string | null | undefined)[], startsAt: Date, timezone: string, used: boolean, kind: "entradas" | "consumo") => {
    if (tipo && tipo !== kind) return false;
    if (estado === "sin-usar" && used) return false;
    if (estado === "usadas" && !used) return false;
    if (dia && dayOf(startsAt, timezone) !== dia) return false;
    return !needle || plain(parts.filter(Boolean).join(" ")).includes(needle);
  };

  for (const t of tickets) {
    if (matches([t.eventTitle, t.typeName, t.venueName, t.seat, t.holderName, t.code, formatCode(t.code)], t.startsAt, t.timezone, t.status === "USED", "entradas")) nightOf(t).entries.push(t);
  }
  for (const v of vouchers) {
    if (matches([v.eventTitle, v.label, v.venueName, v.buyer, v.code, formatCode(v.code), "consumo"], v.startsAt, v.timezone, v.redeemedAt !== null, "consumo")) nightOf(v).vouchers.push(v);
  }

  const all = [...nights.values()];
  const upcoming = all.filter((n) => !n.past);
  const past = all.filter((n) => n.past);
  const count = (list: Night[]) => list.reduce((s, n) => s + n.entries.length + n.vouchers.length, 0);
  const shown = (ver === "pasadas" ? past : upcoming).sort((a, b) => (ver === "pasadas" ? b.startsAt.getTime() - a.startsAt.getTime() : a.startsAt.getTime() - b.startsAt.getTime()));
  const hasAnything = tickets.length > 0 || vouchers.length > 0;
  const filtered = Boolean(q || dia || tipo || estado);

  const tabHref = (v: "proximas" | "pasadas") => {
    const p = new URLSearchParams(Object.entries({ q, dia, tipo, estado, ver: v === "pasadas" ? "pasadas" : "" }).filter(([, val]) => val) as [string, string][]);
    const s = p.toString();
    return s ? `/mis-entradas?${s}` : "/mis-entradas";
  };

  // Los QR solo se dibujan para lo que sigue vigente (las funciones pasadas no llevan QR).
  const cards = ver === "pasadas" ? [] : upcoming;
  const entryQr = new Map<string, { qr: string | null; barcode: string | null }>();
  const voucherQr = new Map<string, string>();
  await Promise.all([
    ...cards.flatMap((n) =>
      n.entries.map(async (t) => {
        entryQr.set(t.id, {
          // Una entrada de QR dinámico no lleva QR fijo: se abre en su propia página, donde el QR cambia cada 30 s.
          qr:
            t.qrMode !== "DYNAMIC" && t.accessMethods.includes("QR")
              ? await QRCode.toString(await signTicketPayload(t.code, secret), { type: "svg", margin: 1, errorCorrectionLevel: "M" })
              : null,
          barcode: t.qrMode !== "DYNAMIC" && t.accessMethods.includes("BARCODE") ? code128Svg(t.code, { height: 56 }) : null,
        });
      }),
    ),
    ...cards.flatMap((n) =>
      n.vouchers.map(async (v) => {
        voucherQr.set(v.id, await QRCode.toString(await signVoucherPayload(v.code, secret), { type: "svg", margin: 1, errorCorrectionLevel: "M" }));
      }),
    ),
  ]);
  const dynamicCodes = upcoming.flatMap((n) => n.entries).filter((t) => t.qrMode === "DYNAMIC" && t.status === "VALID").map((t) => t.code);

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

      {sp.aviso && (
        <p role="status" className="rounded-xl border border-[var(--highlight)]/40 bg-[var(--highlight)]/10 px-4 py-3 text-sm">
          {sp.aviso}
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
                  Si la aceptas pasa a tu cuenta con tu nombre y tu carnet, y su QR anterior deja de valer. Vence el {formatDateTime(t.expiresAt, t.timezone)}.
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

      {!hasAnything ? (
        <p className="text-[var(--ink-muted)]">
          Todavía no tienes entradas con esta cuenta.{" "}
          <Link href="/" className="text-[var(--accent-text)] underline underline-offset-4">
            Ver eventos
          </Link>
        </p>
      ) : (
        <>
          <TicketFilters key={JSON.stringify({ q, dia, tipo, estado, ver })} q={q} dia={dia} tipo={tipo} estado={estado} ver={ver} />

          <nav aria-label="Secciones" className="flex gap-1 border-b border-[var(--border)]">
            {[
              { id: "proximas" as const, label: "Próximas", n: count(upcoming) },
              { id: "pasadas" as const, label: "Pasadas", n: count(past) },
            ].map((tab) => (
              <Link
                key={tab.id}
                href={tabHref(tab.id)}
                aria-current={ver === tab.id ? "page" : undefined}
                className={`-mb-px border-b-2 px-4 py-2 text-sm ${ver === tab.id ? "border-[var(--accent)] font-semibold text-[var(--ink)]" : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"}`}
              >
                {tab.label} <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-xs">{tab.n}</span>
              </Link>
            ))}
          </nav>

          {shown.length === 0 ? (
            <p className="text-[var(--ink-muted)]">
              {filtered
                ? "Nada coincide con la búsqueda."
                : ver === "pasadas"
                  ? "Todavía no tienes funciones pasadas."
                  : "No tienes entradas para próximas funciones."}{" "}
              {ver === "proximas" && !filtered && (
                <Link href="/" className="text-[var(--accent-text)] underline underline-offset-4">
                  Ver eventos
                </Link>
              )}
            </p>
          ) : (
            <div className="space-y-10">
              {shown.map((n) => (
                <section key={n.key} className="space-y-4">
                  <div>
                    <h2 className="font-display text-2xl">{n.eventTitle}</h2>
                    <p className="text-sm text-[var(--ink-muted)]">
                      {formatDateTime(n.startsAt, n.timezone)} · {n.venueName}
                    </p>
                  </div>

                  {n.past ? (
                    <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)]">
                      {n.entries.map((t) => (
                        <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                          <span>
                            <span className="font-semibold">{t.typeName}</span>
                            {t.seat ? <span className="text-[var(--ink-muted)]"> · {t.seat}</span> : null}
                            <span className="block font-mono text-xs text-[var(--ink-dim)]">{formatCode(t.code)}</span>
                          </span>
                          <span className="text-xs font-semibold text-[var(--ink-muted)]">{t.status === "USED" ? "Usada" : "No usada"}</span>
                        </li>
                      ))}
                      {n.vouchers.map((v) => (
                        <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                          <span>
                            <span className="font-semibold">QR de consumo · {v.label}</span>
                            <span className="block text-xs text-[var(--ink-muted)]">{formatMoney(v.amount, v.currency)}</span>
                          </span>
                          <span className="text-xs font-semibold text-[var(--ink-muted)]">{v.cancelled ? "Anulado" : v.redeemedAt ? `Leído a las ${formatClock(v.redeemedAt, v.timezone)}` : "No se leyó"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="grid gap-4 sm:grid-cols-2">
                      {n.entries.map((t) => {
                        const art = entryQr.get(t.id) ?? { qr: null, barcode: null };
                        const ownsVoucher = vouchers.some((v) => v.id === t.creditId);
                        return (
                          <li key={t.id} className="rounded-2xl bg-[#F5F6F8] p-5 text-center text-[#192438]">
                            <p className="text-xs uppercase tracking-wide text-[#60718B]">{t.receivedByTransfer ? "Recibida por transferencia" : "Entrada"}</p>
                            <p className="font-display text-xl">{t.eventTitle}</p>
                            <p className="text-xs text-[#60718B]">
                              {formatDateTime(t.startsAt, t.timezone)} · {t.venueName}
                            </p>
                            {(t.whenWhere.when.doors || t.whenWhere.when.end) && (
                              <p className="text-xs text-[#60718B]">{[t.whenWhere.when.doors, t.whenWhere.when.lastEntry, t.whenWhere.when.end].filter(Boolean).join(" · ")}</p>
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
                            {t.entryUntil && t.status === "VALID" && <p className="mt-1 text-sm font-bold text-[#B77900]">Válida para entrar hasta las {formatClock(t.entryUntil, t.timezone)}</p>}
                            {t.consumption && (
                              <p className="mx-auto mt-2 w-fit rounded-full bg-[#192438] px-3 py-1 text-xs font-semibold text-[#F5B700]">
                                Consumo {t.consumption.shared ? "de la mesa" : "incluido"}: {formatMoney(t.consumption.amount, t.consumption.currency)}
                                {ownsVoucher ? " · tu QR de consumo está más abajo" : " · lo tiene quien compró la mesa"}
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
                            {art.qr && <div className="mx-auto my-3 w-44" dangerouslySetInnerHTML={{ __html: art.qr }} />}
                            {art.barcode && (
                              <div className="mx-auto my-3 w-full max-w-60 overflow-hidden rounded-md bg-white [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: art.barcode }} />
                            )}
                            {t.accessMethods.includes("NFC") && (
                              <p className="my-2 text-xs font-semibold text-[#60718B]">{art.qr || art.barcode ? "También se lee por NFC." : "Se lee por NFC: acércala al lector."}</p>
                            )}
                            <p className="font-mono text-sm tracking-wider">{formatCode(t.code)}</p>
                            {t.status === "USED" && <p className="mt-1 text-xs font-semibold text-[#60718B]">{usedTicketText(t.maxEntries)}</p>}
                            {(art.qr || art.barcode) && canDownloadTicketImage({ status: t.status, qrMode: t.qrMode, accessMethods: t.accessMethods, maxEntries: t.maxEntries }) && (
                              <DownloadTicketButton
                                ticket={{
                                  code: formatCode(t.code),
                                  eventTitle: t.eventTitle,
                                  when: formatDateTime(t.startsAt, t.timezone),
                                  venue: t.venueName,
                                  holder: t.holderName,
                                  typeName: t.typeName,
                                  lines: [t.entrance, t.seat, t.entryUntil ? `Válida para entrar hasta las ${formatClock(t.entryUntil, t.timezone)}` : null, reentryText(t.maxEntries)].filter((l): l is string => Boolean(l)),
                                  qrSvg: art.qr,
                                  barcodeSvg: art.barcode,
                                  consumptionNote: t.consumption ? `Consumo ${t.consumption.shared ? "de la mesa" : "incluido"} ${formatMoney(t.consumption.amount, t.consumption.currency)} · el QR de consumo va aparte` : null,
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
                        );
                      })}

                      {n.vouchers.map((v) => (
                        <li key={v.id} className="rounded-2xl bg-[#F5F6F8] p-5 text-center text-[#192438]">
                          <p className="text-xs uppercase tracking-wide text-[#60718B]">QR de consumo</p>
                          <p className="font-display text-xl">{v.eventTitle}</p>
                          <p className="text-xs text-[#60718B]">
                            {formatDateTime(v.startsAt, v.timezone)} · {v.venueName}
                          </p>
                          <p className="mt-1 font-semibold">{v.label}</p>
                          <p className="mt-1 text-lg font-bold text-[#16846C]">{formatMoney(v.amount, v.currency)}</p>
                          {v.extra > 0 && <p className="text-xs text-[#60718B]">Incluido {formatMoney(v.amount - v.extra, v.currency)} + extra {formatMoney(v.extra, v.currency)}</p>}
                          {v.shared && <p className="text-xs text-[#60718B]">Consumo compartido por toda la mesa</p>}
                          {voucherQr.get(v.id) && <div className={`mx-auto my-3 w-44 ${v.redeemedAt || v.cancelled ? "opacity-30" : ""}`} dangerouslySetInnerHTML={{ __html: voucherQr.get(v.id)! }} />}
                          <p className="font-mono text-sm tracking-wider">{formatCode(v.code)}</p>
                          <p className={`mt-1 text-xs font-semibold ${v.redeemedAt || v.cancelled ? "text-[#C62842]" : "text-[#60718B]"}`}>
                            {v.cancelled ? "Anulado" : v.redeemedAt ? `Ya fue leído a las ${formatClock(v.redeemedAt, v.timezone)}` : "Sin usar: se lee una sola vez en la barra"}
                          </p>
                          {voucherQr.get(v.id) && canDownloadVoucherImage(v) && (
                            <DownloadTicketButton
                              ticket={{
                                kind: "consumo",
                                code: formatCode(v.code),
                                eventTitle: v.eventTitle,
                                when: formatDateTime(v.startsAt, v.timezone),
                                venue: v.venueName,
                                holder: v.buyer,
                                typeName: v.label,
                                lines: [v.shared ? "Consumo compartido por toda la mesa" : null, v.extra > 0 ? `Incluido ${formatMoney(v.amount - v.extra, v.currency)} + extra ${formatMoney(v.extra, v.currency)}` : null].filter((l): l is string => Boolean(l)),
                                qrSvg: voucherQr.get(v.id),
                                amount: formatMoney(v.amount, v.currency),
                              }}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {ver === "proximas" && count(upcoming) > 0 && (
        <p className="text-xs text-[var(--ink-dim)]">
          Cada entrada se puede transferir hasta {MAX_TRANSFERS_PER_TICKET} veces y hasta pocas horas antes de la función. Lleva siempre tu carnet: es a tu nombre. Cuando la función pasa, sus QR se
          van a «Pasadas».
        </p>
      )}
    </main>
  );
}
