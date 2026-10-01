import Link from "next/link";
import { connection } from "next/server";
import { CATEGORY_COLOR, CATEGORY_LABEL, formatDate, formatMoney } from "@ticketera/core";
import { EventCategory } from "@ticketera/db";
import { EventImage } from "@/components/event-image";
import { listPublishedEvents } from "@/lib/events";

type Props = { searchParams: Promise<{ categoria?: string }> };

export default async function HomePage({ searchParams }: Props) {
  await connection();
  const requested = (await searchParams).categoria?.toUpperCase();
  const category = Object.values(EventCategory).find((c) => c === requested);
  const events = await listPublishedEvents(category);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="mb-8 flex flex-col gap-2">
        <p className="eyebrow">Bolivia · en vivo</p>
        <h1 className="font-display text-4xl leading-[0.95] sm:text-5xl">Próximos eventos</h1>
      </div>

      <nav className="mb-8 flex flex-wrap gap-2 text-sm" aria-label="Filtrar por categoría">
        <Link
          href="/"
          className={`rounded-full border px-3 py-1 ${!category ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border-light)] text-[var(--ink-muted)]"}`}
        >
          Todos
        </Link>
        {Object.values(EventCategory)
          .filter((c) => c !== "OTRO")
          .map((c) => (
            <Link
              key={c}
              href={`/?categoria=${c.toLowerCase()}`}
              className={`rounded-full border px-3 py-1 ${category === c ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border-light)] text-[var(--ink-muted)]"}`}
            >
              {CATEGORY_LABEL[c]}
            </Link>
          ))}
      </nav>

      {events.length === 0 ? (
        <p className="text-[var(--ink-muted)]">No hay eventos publicados por ahora.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event, i) => {
            const color = CATEGORY_COLOR[event.category] ?? CATEGORY_COLOR.OTRO;
            return (
              <li key={event.slug}>
                <Link
                  href={`/eventos/${event.slug}`}
                  className="group grain relative flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] transition-all duration-300 hover:-translate-y-1 hover:border-[var(--border-light)]"
                  style={{ animation: `fade-up 0.5s ease-out ${i * 60}ms both` }}
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--bg-raised-2)]">
                    <EventImage
                      src={event.imageUrl}
                      title={event.title}
                      eager={i < 3}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--bg-raised)] via-transparent to-transparent" />
                    <span
                      className="absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
                      style={{ background: color, color: "#0b0b10" }}
                    >
                      {CATEGORY_LABEL[event.category] ?? "Evento"}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col gap-1 p-4">
                    <h2 className="font-display text-xl leading-tight text-[var(--ink)]">{event.title}</h2>
                    <p className="text-sm text-[var(--ink-muted)]">
                      {event.nextSession.venue.name}
                      {event.nextSession.venue.city && ` · ${event.nextSession.venue.city}`}
                    </p>
                    <p className="text-sm capitalize text-[var(--ink-dim)]">
                      {formatDate(event.nextSession.startsAt, event.nextSession.venue.timezone)}
                      {event.sessionCount > 1 && ` · ${event.sessionCount} funciones`}
                    </p>
                    <div className="mt-auto flex items-baseline justify-between pt-3">
                      <span className="text-[11px] uppercase tracking-wide text-[var(--ink-dim)]">Desde</span>
                      <span className="font-display text-lg text-[var(--accent)]">
                        {event.minPrice ? formatMoney(event.minPrice.unitAmount, event.minPrice.currency) : "—"}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
