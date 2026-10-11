import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CATEGORY_COLOR, CATEGORY_LABEL, formatDate, formatDateTime, formatMoney, currentPrice, saleState } from "@ticketera/core";
import { getSessionAvailability } from "@ticketera/db";
import { EventImage } from "@/components/event-image";
import { getPublishedEvent } from "@/lib/events";

type Props = { params: Promise<{ slug: string }> };

/** Por debajo de este número se avisa "últimas entradas". */
const LOW_STOCK = 20;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getPublishedEvent((await params).slug);
  return event ? { title: event.title, description: event.description ?? undefined } : {};
}

export default async function EventPage({ params }: Props) {
  await connection();
  const event = await getPublishedEvent((await params).slug);
  if (!event) notFound();

  const now = new Date();
  const sessions = await Promise.all(
    event.sessions
      .filter((s) => s.startsAt > now)
      .map(async (s) => {
        const remaining = await getSessionAvailability(s.id, now);
        // Solo lo que se vende ahora: una preventa vencida no cuenta, una general que empieza después tampoco.
        const open = s.ticketTypes.filter((t) => saleState(t, now) === "open");
        const left = open.reduce((sum, t) => sum + (remaining.get(t.id) ?? 0), 0);
        const priced = open.length ? open : s.ticketTypes.filter((t) => saleState(t, now) !== "closed");
        const effective = priced.map((t) => ({ type: t, price: currentPrice(t, now) }));
        const minPrice = effective.reduce<number | null>((m, x) => (m === null || x.price.unitAmount < m ? x.price.unitAmount : m), null);
        const presale = open.find((t) => t.presale && t.salesEndAt);
        // Descuento de preventa vigente: el mayor porcentaje y hasta cuándo.
        const discount = effective
          .filter((x) => x.price.discountPercent)
          .toSorted((a, b) => b.price.discountPercent! - a.price.discountPercent!)[0]?.price;
        return {
          ...s,
          left,
          minPrice,
          presaleUntil: presale?.salesEndAt ?? null,
          discount: discount ? { percent: discount.discountPercent!, until: discount.discountEndsAt! } : null,
        };
      }),
  );
  const color = CATEGORY_COLOR[event.category] ?? CATEGORY_COLOR.OTRO;
  const venue = sessions[0]?.venue ?? event.sessions[0]?.venue;

  return (
    <main className="pb-16">
      <div className="relative h-[42vh] min-h-[280px] w-full overflow-hidden bg-[var(--bg-raised)]">
        {event.imageUrl && (
          <div className="absolute inset-0">
            <EventImage src={event.imageUrl} title={event.title} eager className="h-full w-full object-cover" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg)]/70 via-transparent to-transparent" />
        <div className="relative mx-auto flex h-full max-w-6xl flex-col justify-end gap-3 px-6 pb-8">
          <span
            className="w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
            style={{ background: color, color: "#0b0b10" }}
          >
            {CATEGORY_LABEL[event.category] ?? "Evento"}
          </span>
          <h1 className="font-display max-w-3xl text-4xl leading-[0.95] sm:text-6xl">{event.title}</h1>
          {venue && (
            <p className="text-[var(--ink-muted)]">
              {venue.name}
              {venue.address && ` · ${venue.address}`}
              {venue.city && `, ${venue.city}`}
            </p>
          )}
          {!event.organization.isPlatform && (
            <p className="text-sm text-[var(--ink-dim)]">Organiza: {event.organization.name}</p>
          )}
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 pt-10 lg:grid-cols-[1fr_380px]">
        <div>
          <h2 className="mb-3 font-display text-2xl">Sobre el evento</h2>
          <p className="whitespace-pre-wrap leading-relaxed text-[var(--ink-muted)]">
            {event.description ?? "Pronto más información."}
          </p>
        </div>

        <div>
          <h2 className="mb-3 font-display text-2xl">Funciones</h2>
          {sessions.length === 0 ? (
            <p className="text-[var(--ink-muted)]">No hay funciones disponibles.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {sessions.map((s) => {
                const soldOut = s.left <= 0;
                const time = new Intl.DateTimeFormat("es-BO", {
                  timeZone: s.venue.timezone,
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                }).format(s.startsAt);
                const body = (
                  <>
                    <div>
                      <p className="font-semibold capitalize">{formatDate(s.startsAt, s.venue.timezone)}</p>
                      <p className="text-sm text-[var(--ink-dim)]">
                        {time} hs · {s.venue.name}
                      </p>
                      <p className="mt-1 text-xs">
                        {s.minPrice !== null && (
                          <span className="text-[var(--ink-muted)]">Desde {formatMoney(s.minPrice, s.ticketTypes[0]!.currency)}</span>
                        )}
                        {!soldOut && s.left <= LOW_STOCK && (
                          <span className="ml-2 font-semibold text-[var(--accent-2)]">¡Últimas {s.left}!</span>
                        )}
                        {s.queueEnabled && <span className="ml-2 text-[var(--accent)]">Fila virtual</span>}
                      </p>
                      {s.presaleUntil && (
                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--accent-2)]">
                          Preventa hasta {formatDateTime(s.presaleUntil, s.venue.timezone)}
                        </p>
                      )}
                      {s.discount && (
                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--accent-2)]">
                          Preventa: {s.discount.percent}% menos hasta {formatDateTime(s.discount.until, s.venue.timezone)}
                        </p>
                      )}
                    </div>
                    <span
                      className={
                        soldOut
                          ? "text-sm font-medium text-[var(--ink-dim)]"
                          : "text-sm font-semibold text-[var(--accent)] transition-transform group-hover:translate-x-1"
                      }
                    >
                      {soldOut ? "Agotado" : "Comprar →"}
                    </span>
                  </>
                );
                return (
                  <li key={s.id}>
                    {soldOut ? (
                      <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] px-5 py-4 opacity-60">
                        {body}
                      </div>
                    ) : (
                      <Link
                        href={`/comprar/${s.id}`}
                        className="group flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] px-5 py-4 transition-colors hover:border-[var(--accent)]"
                      >
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
