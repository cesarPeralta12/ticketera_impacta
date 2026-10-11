import Link from "next/link";
import { connection } from "next/server";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  calendarDaysUntil,
  formatDateTime,
  formatMoney,
  offerLine,
  pickFeatured,
  relativeDay,
  salesBadges,
} from "@ticketera/core";
import { EventCategory } from "@ticketera/db";
import { EventStub } from "@/components/home/event-card";
import { EventRow } from "@/components/home/event-row";
import { HeroCarousel, type HeroSlide } from "@/components/home/hero-carousel";
import { Ticker } from "@/components/home/ticker";
import { listPublishedEvents, type EventCard } from "@/lib/events";

type Props = { searchParams: Promise<{ categoria?: string; q?: string }> };

function toSlide(event: EventCard, now: Date): HeroSlide {
  const tz = event.nextSession.venue.timezone;
  return {
    slug: event.slug,
    title: event.title,
    imageUrl: event.imageUrl,
    category: CATEGORY_LABEL[event.category] ?? "Evento",
    categoryColor: CATEGORY_COLOR[event.category] ?? CATEGORY_COLOR.OTRO!,
    when: formatDateTime(event.nextSession.startsAt, tz),
    venue: `${event.nextSession.venue.name}${event.nextSession.venue.city ? ` · ${event.nextSession.venue.city}` : ""}`,
    soon: relativeDay(event.nextSession.startsAt, now, tz),
    price: event.minPrice ? formatMoney(event.minPrice.unitAmount, event.minPrice.currency) : null,
    listPrice: event.listAmount !== null && event.minPrice ? formatMoney(event.listAmount, event.minPrice.currency) : null,
    // En el carrusel el "hoy/mañana" ya va aparte: se quita de las insignias para no repetirlo.
    badges: salesBadges(event.sales, now).filter((b) => b.kind !== "soon"),
    offer: offerLine(event.sales, now),
    stickerPercent: event.sales.onSale ? event.sales.discountPercent : null,
  };
}

export default async function HomePage({ searchParams }: Props) {
  await connection();
  const params = await searchParams;
  const requested = params.categoria?.toUpperCase();
  const category = Object.values(EventCategory).find((c) => c === requested);
  const search = params.q?.trim().slice(0, 60) || undefined;
  const filtered = Boolean(category || search);

  const now = new Date();
  const events = await listPublishedEvents(category, search);

  // Lo destacado solo en la portada sin filtros: con una búsqueda se muestran los resultados.
  const featured = filtered ? [] : pickFeatured(events.map((e) => ({ ...e, ...e.sales })), now, 5);
  const slides = (featured.length > 0 ? featured : filtered ? [] : events.slice(0, 5)).map((e) => toSlide(e, now));

  const endsAt = (e: EventCard) => (e.sales.discountUntil ?? e.sales.presaleUntil ?? e.sales.startsAt).getTime();
  const onOffer = events
    .filter((e) => e.sales.onSale && e.sales.left > 0 && (e.sales.discountPercent || e.sales.presaleUntil))
    .toSorted((a, b) => (b.sales.discountPercent ?? 0) - (a.sales.discountPercent ?? 0) || endsAt(a) - endsAt(b));
  const lastSeats = events.filter((e) => salesBadges(e.sales, now).some((b) => b.kind === "low" || b.kind === "hot"));
  const thisWeek = events.filter((e) => {
    const days = calendarDaysUntil(e.nextSession.startsAt, now, e.nextSession.venue.timezone);
    return days >= 0 && days <= 7;
  });

  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition-colors ${active ? "border-[var(--accent)] bg-[var(--accent)]/10 font-semibold text-[var(--accent)]" : "border-[var(--border-light)] text-[var(--ink-muted)] hover:border-[var(--ink-muted)] hover:text-[var(--ink)]"}`;
  const chipHref = (c?: string) => {
    const qs = new URLSearchParams();
    if (c) qs.set("categoria", c.toLowerCase());
    if (search) qs.set("q", search);
    const s = qs.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <main>
      <h1 className="sr-only">Impacta: entradas para eventos en Bolivia</h1>

      {slides.length > 0 && (
        <>
          <HeroCarousel slides={slides} />
          <Ticker events={events} />
        </>
      )}

      <div className="mx-auto w-full max-w-6xl space-y-14 px-6 py-10">
        <section aria-label="Buscar y filtrar" className="space-y-4">
          <form action="/" role="search" className="flex flex-col gap-3 sm:flex-row">
            {category && <input type="hidden" name="categoria" value={category.toLowerCase()} />}
            <label className="sr-only" htmlFor="buscar">
              Buscar eventos
            </label>
            <input
              id="buscar"
              name="q"
              defaultValue={search}
              placeholder="Busca un evento, un recinto o una ciudad…"
              className="field flex-1 !rounded-full !px-5 !py-3"
              maxLength={60}
            />
            <button type="submit" className="btn-accent px-7">
              Buscar
            </button>
          </form>
          <nav className="flex flex-wrap gap-2" aria-label="Filtrar por categoría">
            <Link href={chipHref()} className={chip(!category)}>
              Todos
            </Link>
            {Object.values(EventCategory)
              .filter((c) => c !== "OTRO")
              .map((c) => (
                <Link key={c} href={chipHref(c)} className={chip(category === c)}>
                  {CATEGORY_LABEL[c]}
                </Link>
              ))}
          </nav>
        </section>

        {!filtered && onOffer.length > 0 && (
          <EventRow title="En preventa y con descuento" subtitle="Compra ahora, antes de que suba el precio." accent="var(--accent-2)">
            {onOffer.map((e, i) => (
              <li key={e.slug}>
                <EventStub event={e} now={now} eager={i < 2} />
              </li>
            ))}
          </EventRow>
        )}

        {!filtered && lastSeats.length > 0 && (
          <EventRow title="Últimos lugares" subtitle="Se están agotando.">
            {lastSeats.map((e) => (
              <li key={e.slug}>
                <EventStub event={e} now={now} />
              </li>
            ))}
          </EventRow>
        )}

        {!filtered && thisWeek.length > 0 && (
          <EventRow title="Esta semana" subtitle="Lo que pasa en los próximos 7 días.">
            {thisWeek.map((e) => (
              <li key={e.slug}>
                <EventStub event={e} now={now} />
              </li>
            ))}
          </EventRow>
        )}

        <section aria-label="Todos los eventos" className="space-y-5">
          <div>
            <h2 className="font-display text-2xl leading-none sm:text-3xl">
              {search ? `Resultados para “${search}”` : category ? CATEGORY_LABEL[category] : "Todos los eventos"}
            </h2>
            <p className="mt-1.5 text-sm text-[var(--ink-muted)]">
              {events.length === 0 ? "" : `${events.length} ${events.length === 1 ? "evento" : "eventos"}${filtered ? "" : ", del más próximo al más lejano"}`}
            </p>
          </div>
          {events.length === 0 ? (
            <div className="card space-y-3 p-8 text-center">
              <p className="font-display text-2xl">{filtered ? "No encontramos eventos con ese filtro" : "No hay eventos publicados por ahora"}</p>
              {filtered && (
                <Link href="/" className="btn-ghost">
                  Ver todos los eventos
                </Link>
              )}
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((e, i) => (
                <li key={e.slug} style={{ animation: `fade-up 0.5s ease-out ${Math.min(i, 8) * 50}ms both` }}>
                  <EventStub event={e} now={now} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {!filtered && (
          <section aria-label="Cómo funciona" className="grid gap-6 border-t border-[var(--border)] pt-10 sm:grid-cols-3">
            {[
              ["01", "Elige tu lugar", "Mapa del recinto con butacas y zonas. Preventas y promociones a la vista."],
              ["02", "Compra con tu cuenta", "Tus entradas salen a tu nombre y llegan a tu correo. Puedes transferirlas a otra persona."],
              ["03", "Entra con tu celular", "Tu QR funciona también sin internet y te dice por qué puerta ingresar."],
            ].map(([n, title, text]) => (
              <div key={n} className="flex gap-4">
                <span className="font-display text-4xl leading-none text-[var(--accent)]">{n}</span>
                <div>
                  <h3 className="font-display text-lg leading-tight">{title}</h3>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{text}</p>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
