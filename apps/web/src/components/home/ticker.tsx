import { shortDate } from "@ticketera/core";
import type { EventCard } from "@/lib/events";

/** Cinta con los próximos eventos que corre sola (decorativa: el contenido ya está en la página). */
export function Ticker({ events }: { events: EventCard[] }) {
  if (events.length === 0) return null;
  const items = events.slice(0, 10).map((e) => `${e.title} · ${shortDate(e.nextSession.startsAt, e.nextSession.venue.timezone)}`);
  const loop = [...items, ...items];
  return (
    <div className="ticker overflow-hidden border-y border-[var(--border)] bg-[var(--accent)] py-2 text-[var(--accent-ink)]" aria-hidden>
      <div className="ticker-track font-display text-sm uppercase tracking-[0.18em]">
        {loop.map((text, i) => (
          <span key={i} className="flex items-center whitespace-nowrap px-5">
            {text}
            <span className="pl-10 text-[10px]">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}
