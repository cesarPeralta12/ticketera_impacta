import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { formatCode, formatDateTime, formatMoney, formatTime } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { ticketQrSvg } from "@/lib/ticket-qr";
import { TransferForm } from "./transfer-form";

export const metadata: Metadata = { title: "Mis eventos", robots: { index: false } };

const statusText: Record<string, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Confirmada",
  EXPIRED: "Reserva vencida",
  CANCELLED: "Cancelada",
  REFUNDED: "Reembolsada",
  PARTIALLY_REFUNDED: "Reembolso parcial",
};

/** Una función se considera "próxima" hasta 6 h después de empezar (el evento en curso). */
const IN_PROGRESS_MS = 6 * 60 * 60_000;

/**
 * Entradas que son de esta cuenta (compradas con ella o recibidas por transferencia),
 * separadas en próximas e historial, con su QR.
 */
async function myTickets(customerId: string) {
  const now = new Date();
  const tickets = await prisma.ticket.findMany({
    where: { customerId, status: { in: ["VALID", "USED"] } },
    orderBy: [{ session: { startsAt: "asc" } }, { issuedAt: "asc" }],
    include: {
      ticketType: { select: { name: true } },
      seat: { select: { label: true, section: { select: { name: true } } } },
      order: { select: { channel: true } },
      session: {
        include: {
          event: { select: { title: true, slug: true } },
          venue: { select: { name: true, timezone: true } },
        },
      },
      transfers: {
        where: { toCustomerId: customerId },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { from: { select: { name: true } } },
      },
    },
  });

  const withQr = await Promise.all(
    tickets.map(async (t) => ({
      ...t,
      qr: t.status === "VALID" ? await ticketQrSvg(t.code) : null,
      transferable: t.status === "VALID" && t.order.channel !== "GUEST" && t.session.startsAt > now,
      receivedFrom: t.transfers[0]?.from.name ?? null,
    })),
  );
  type Item = (typeof withQr)[number];
  const group = (items: Item[]) => {
    const bySession = new Map<string, { session: Item["session"]; tickets: Item[] }>();
    for (const t of items) {
      const entry = bySession.get(t.sessionId) ?? { session: t.session, tickets: [] };
      entry.tickets.push(t);
      bySession.set(t.sessionId, entry);
    }
    return [...bySession.values()];
  };
  const cutoff = now.getTime() - IN_PROGRESS_MS;
  return {
    upcoming: group(withQr.filter((t) => t.session.startsAt.getTime() >= cutoff)),
    past: group(withQr.filter((t) => t.session.startsAt.getTime() < cutoff)).reverse(),
  };
}

export default async function MyEventsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/mis-eventos");
  const customerId = session.user.id;

  const [{ upcoming, past }, sent, orders] = await Promise.all([
    myTickets(customerId),
    prisma.ticketTransfer.findMany({
      where: { fromCustomerId: customerId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        to: { select: { name: true, email: true } },
        ticket: {
          select: {
            ticketType: { select: { name: true } },
            session: { select: { startsAt: true, event: { select: { title: true } }, venue: { select: { timezone: true } } } },
          },
        },
      },
    }),
    // Solo órdenes hechas con la cuenta iniciada: nunca se buscan por email, que nadie verificó.
    prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      include: {
        items: { take: 1, include: { ticketType: { include: { session: { include: { event: true, venue: true } } } } } },
        _count: { select: { tickets: true } },
      },
    }),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-10 px-6 py-12">
      <div>
        <p className="eyebrow">{session.user.name}</p>
        <h1 className="font-display text-4xl">Mis eventos</h1>
      </div>

      <section className="space-y-4">
        <h2 className="font-display text-2xl">Próximos</h2>
        {upcoming.length === 0 ? (
          <p className="text-[var(--ink-muted)]">
            No tienes entradas para próximos eventos.{" "}
            <Link href="/" className="text-[var(--accent)] underline underline-offset-4">
              Ver eventos
            </Link>
          </p>
        ) : (
          upcoming.map(({ session: s, tickets }) => (
            <div key={s.id} className="card space-y-4 p-5">
              <div>
                <Link href={`/eventos/${s.event.slug}`} className="font-display text-xl hover:text-[var(--accent)]">
                  {s.event.title}
                </Link>
                <p className="text-sm capitalize text-[var(--ink-muted)]">
                  {formatDateTime(s.startsAt, s.venue.timezone)} · {s.venue.name}
                </p>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2">
                {tickets.map((t) => (
                  // Boleto claro: el QR se lee mejor con fondo blanco.
                  <li key={t.id} className="space-y-2 rounded-2xl bg-[#f5f3ef] p-5 text-center text-[#14181b]">
                    <p className="font-display text-lg">{t.ticketType.name}</p>
                    {t.seat && (
                      <p className="text-sm font-semibold">
                        {t.seat.section.name} · {t.seat.label}
                      </p>
                    )}
                    {t.holderName && <p className="text-xs text-[#6b687a]">{t.holderName}</p>}
                    {t.qr ? (
                      <div className="mx-auto w-44" dangerouslySetInnerHTML={{ __html: t.qr }} />
                    ) : (
                      <p className="py-6 text-sm font-semibold text-[#6b687a]">
                        Ya utilizada{t.usedAt && ` · ${formatTime(t.usedAt, s.venue.timezone)}`}
                      </p>
                    )}
                    <p className="font-mono text-sm tracking-wider">{formatCode(t.code)}</p>
                    {t.receivedFrom && <p className="text-[11px] text-[#6b687a]">Te la transfirió {t.receivedFrom}</p>}
                    {t.transferable && <TransferForm ticketId={t.id} label={`"${t.ticketType.name}" de ${s.event.title}`} />}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {sent.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Entradas que transferiste</h2>
          <ul className="flex flex-col gap-2">
            {sent.map((t) => (
              <li key={t.id} className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="font-display text-lg">{t.ticket.session.event.title}</p>
                  <p className="text-sm capitalize text-[var(--ink-muted)]">
                    {formatDateTime(t.ticket.session.startsAt, t.ticket.session.venue.timezone)} · {t.ticket.ticketType.name}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p>
                    A {t.to.name} <span className="text-[var(--ink-dim)]">({t.to.email})</span>
                  </p>
                  <p className="text-[var(--ink-dim)]">
                    {formatDateTime(t.createdAt, t.ticket.session.venue.timezone)} · tu QR ya no vale
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Historial</h2>
          <ul className="flex flex-col gap-2">
            {past.map(({ session: s, tickets }) => (
              <li key={s.id} className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="font-display text-lg">{s.event.title}</p>
                  <p className="text-sm capitalize text-[var(--ink-muted)]">
                    {formatDateTime(s.startsAt, s.venue.timezone)} · {s.venue.name}
                  </p>
                </div>
                <div className="text-right text-sm">
                  {tickets.map((t) => (
                    <p key={t.id} className={t.status === "USED" ? "text-[var(--green)]" : "text-[var(--ink-dim)]"}>
                      {t.ticketType.name}:{" "}
                      {t.status === "USED"
                        ? `ingresaste${t.usedAt ? ` a las ${formatTime(t.usedAt, s.venue.timezone)}` : ""}`
                        : "no asististe"}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-2xl">Mis compras</h2>
        {orders.length === 0 ? (
          <p className="text-[var(--ink-muted)]">Todavía no compraste con esta cuenta.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {orders.map((order) => {
              const s = order.items[0]?.ticketType.session;
              return (
                <li key={order.id}>
                  <Link
                    href={`/orden/${order.code}`}
                    className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-[var(--accent)]"
                  >
                    <div>
                      <p className="font-display text-lg">{s?.event.title}</p>
                      {s && (
                        <p className="text-sm capitalize text-[var(--ink-muted)]">
                          {formatDateTime(s.startsAt, s.venue.timezone)} · {s.venue.name}
                        </p>
                      )}
                      <p className="font-mono text-xs text-[var(--ink-dim)]">Orden {formatCode(order.code)}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p className={order.status === "PAID" ? "font-semibold text-[var(--green)]" : "text-[var(--ink-muted)]"}>
                        {statusText[order.status]}
                      </p>
                      <p className="text-[var(--ink-dim)]">
                        {order._count.tickets > 0 ? `${order._count.tickets} entrada(s) · ` : ""}
                        {formatMoney(order.totalAmount, order.currency)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
