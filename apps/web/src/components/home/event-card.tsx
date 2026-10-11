import Link from "next/link";
import { CATEGORY_COLOR, CATEGORY_LABEL, formatMoney, offerLine, relativeDay, salesBadges, shortDate, weekdayTime, type Badge } from "@ticketera/core";
import { EventImage } from "@/components/event-image";
import type { EventCard } from "@/lib/events";

export function BadgeList({ badges, className = "" }: { badges: Badge[]; className?: string }) {
  if (badges.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {badges.map((b) => (
        <span key={b.kind} className={`tag tag-${b.kind}`}>
          {b.text}
        </span>
      ))}
    </div>
  );
}

/**
 * Entrada de la cartelera: imagen, perforación con muescas y un pie con la fecha grande y el precio.
 * Muestra la preventa, el descuento vigente (sello y precio normal tachado) y los lugares que quedan.
 */
export function EventStub({ event, now, eager = false }: { event: EventCard; now: Date; eager?: boolean }) {
  const color = CATEGORY_COLOR[event.category] ?? CATEGORY_COLOR.OTRO;
  const tz = event.nextSession.venue.timezone;
  const badges = salesBadges(event.sales, now);
  const offer = offerLine(event.sales, now);
  const soldOut = badges.some((b) => b.kind === "soldout");
  const [day, month] = shortDate(event.nextSession.startsAt, tz).split(" ");
  const soon = relativeDay(event.nextSession.startsAt, now, tz);

  return (
    <Link
      href={`/eventos/${event.slug}`}
      className="group stub grain relative flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] transition-transform duration-300 hover:-translate-y-1"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--bg-raised-2)]">
        <EventImage
          src={event.imageUrl}
          title={event.title}
          eager={eager}
          className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 ${soldOut ? "grayscale" : ""}`}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--bg-raised)] via-transparent to-transparent" />
        <span className="absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide" style={{ background: color, color: "#0b0b10" }}>
          {CATEGORY_LABEL[event.category] ?? "Evento"}
        </span>
        {event.sales.onSale && event.sales.discountPercent ? (
          <span className="sticker absolute bottom-3 right-3" aria-label={`${event.sales.discountPercent}% de descuento`}>
            -{event.sales.discountPercent}%
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 px-4 pb-3 pt-3">
        <h3 className="font-display text-xl leading-tight text-[var(--ink)]">{event.title}</h3>
        <p className="text-sm text-[var(--ink-muted)]">
          {event.nextSession.venue.name}
          {event.nextSession.venue.city && ` · ${event.nextSession.venue.city}`}
        </p>
        <BadgeList badges={badges} />
        {offer && <p className="text-xs font-semibold text-[var(--accent)]">{offer}</p>}
      </div>

      <div className="stub-foot flex items-center gap-4 px-4">
        <div className="flex w-12 shrink-0 flex-col items-center leading-none">
          <span className="font-display text-3xl text-[var(--ink)]">{day}</span>
          <span className="mt-0.5 text-[11px] font-bold uppercase tracking-widest text-[var(--accent)]">{month}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-[var(--ink-muted)]">
            {soon && <span className="font-bold text-[var(--green)]">{soon} · </span>}
            <span className="first-letter:uppercase">{weekdayTime(event.nextSession.startsAt, tz)}</span>
          </p>
          {event.sessionCount > 1 && <p className="text-[11px] text-[var(--ink-dim)]">{event.sessionCount} funciones</p>}
        </div>
        <div className="shrink-0 text-right leading-tight">
          <p className="text-[10px] uppercase tracking-wide text-[var(--ink-dim)]">{soldOut ? "Agotado" : "Desde"}</p>
          {event.minPrice && !soldOut ? (
            <>
              {event.listAmount !== null && (
                <p className="text-[11px] text-[var(--ink-dim)] line-through">{formatMoney(event.listAmount, event.minPrice.currency)}</p>
              )}
              <p className="font-display text-lg text-[var(--accent)]">{formatMoney(event.minPrice.unitAmount, event.minPrice.currency)}</p>
            </>
          ) : (
            <p className="font-display text-lg text-[var(--ink-dim)]">—</p>
          )}
        </div>
      </div>
    </Link>
  );
}
