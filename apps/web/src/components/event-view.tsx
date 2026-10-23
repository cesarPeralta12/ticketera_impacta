import Link from "next/link";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  currentPrice,
  describeSessionTimes,
  formatClock,
  formatDateTime,
  formatMoney,
  onlineSalesEnd,
  saleState,
  whenWhere,
} from "@ticketera/core";
import { getSessionAvailability } from "@ticketera/db";
import { ClubOfferView } from "@/components/club-offer";
import { EventImage } from "@/components/event-image";
import { WhenWhereBlock } from "@/components/when-where";
import type { getPublishedEvent } from "@/lib/events";
import { clubOffer } from "@/lib/nightlife";

/** Por debajo de este número se avisa "últimas entradas". */
const LOW_STOCK = 20;

export type ViewableEvent = NonNullable<Awaited<ReturnType<typeof getPublishedEvent>>>;

/**
 * La página de un evento tal como la ve el comprador. `preview`: vista previa desde el panel (el evento puede seguir en
 * borrador): un aviso arriba y las funciones sin enlace para comprar.
 */
export async function EventView({ event, preview = false }: { event: ViewableEvent; preview?: boolean }) {
  const now = new Date();
  const sessions = await Promise.all(
    event.sessions
      .filter((s) => onlineSalesEnd(s) > now)
      .map(async (s) => {
        const remaining = await getSessionAvailability(s.id, now);
        // Solo lo que se vende ahora: una preventa vencida no cuenta, una general que empieza después tampoco.
        const open = s.ticketTypes.filter((t) => saleState(t, now) === "open");
        const left = open.reduce((sum, t) => sum + (remaining.get(t.id) ?? 0), 0);
        const priced = open.length ? open : s.ticketTypes.filter((t) => saleState(t, now) !== "closed");
        const effective = priced.map((t) => ({ type: t, price: currentPrice(t, now) }));
        const minPrice = effective.reduce<number | null>((m, x) => (m === null || x.price.unitAmount < m ? x.price.unitAmount : m), null);
        // Boliche: la free se anuncia aparte ("Free hasta 01:00") y el "desde" es la entrada más barata con precio.
        const free = open.find((t) => currentPrice(t, now).unitAmount === 0 && t.entryUntil && t.entryUntil > now);
        const paid = effective.filter((x) => x.price.unitAmount > 0).map((x) => x.price.unitAmount);
        const presale = open.find((t) => t.presale && t.salesEndAt);
        // Descuento de preventa vigente: el mayor porcentaje y hasta cuándo.
        const discount = effective
          .filter((x) => x.price.discountPercent)
          .toSorted((a, b) => b.price.discountPercent! - a.price.discountPercent!)[0]?.price;
        return {
          ...s,
          left,
          minPrice: free && paid.length ? Math.min(...paid) : minPrice,
          freeUntil: free?.entryUntil ?? null,
          presaleUntil: presale?.salesEndAt ?? null,
          discount: discount ? { percent: discount.discountPercent!, until: discount.discountEndsAt! } : null,
        };
      }),
  );
  const color = CATEGORY_COLOR[event.category] ?? CATEGORY_COLOR.OTRO;
  const venue = sessions[0]?.venue ?? event.sessions[0]?.venue;
  // Boliche: cada función es una noche; se muestra lo que ofrece la próxima (mesas, free, entrada + trago).
  const club = event.category === "BOLICHE";
  const nextNight = club ? sessions.find((s) => s.left > 0) ?? sessions[0] : undefined;
  const offer = nextNight ? clubOffer(nextNight.ticketTypes, await getSessionAvailability(nextNight.id, now), now) : null;

  return (
    <main className="pb-16">
      {preview && (
        <p role="status" className="bg-[var(--accent)] px-6 py-2 text-center text-sm font-semibold text-[var(--accent-ink)]">
          Vista previa: así lo verá el comprador.{event.status !== "PUBLISHED" && " Todavía no está publicado; comprar no funciona."}
        </p>
      )}
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
            style={{ background: color, color: "#192438" }}
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
          {sessions[0] && (
            <div className="mt-8 space-y-3">
              <h2 className="font-display text-2xl">
                Cuándo y dónde
                {sessions.length > 1 && <span className="ml-2 font-sans text-sm font-normal text-[var(--ink-dim)]">{club ? "próxima noche" : "próxima función"}</span>}
              </h2>
              <WhenWhereBlock data={whenWhere({ session: sessions[0], venue: sessions[0].venue, event })} />
            </div>
          )}
          {offer && nextNight && (
            <div className="mt-8 space-y-3">
              <h2 className="font-display text-2xl">Mesas, free y entradas</h2>
              <ClubOfferView offer={offer} currency={nextNight.ticketTypes[0]!.currency} timeZone={nextNight.venue.timezone} detailed />
              <p className="text-xs text-[var(--ink-dim)]">
                Precios de la próxima noche. Cada persona entra con su QR (la mesa trae uno por persona) y el consumo
                incluido se descuenta en la barra mostrando cualquiera de los QR.
              </p>
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 font-display text-2xl">{club ? "Noches" : "Funciones"}</h2>
          {sessions.length === 0 ? (
            <p className="text-[var(--ink-muted)]">{club ? "No hay noches disponibles." : "No hay funciones disponibles."}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {sessions.map((s) => {
                const soldOut = s.left <= 0;
                const when = describeSessionTimes(s, s.venue.timezone, event.category);
                const body = (
                  <>
                    <div>
                      <p className="font-semibold first-letter:uppercase">{when.day}</p>
                      <p className="text-sm text-[var(--ink-dim)]">
                        {[when.doors, when.start].filter(Boolean).join(" · ")} · {s.venue.name}
                      </p>
                      {when.end && <p className="text-xs text-[var(--ink-dim)]">{when.end}</p>}
                      <p className="mt-1 text-xs">
                        {s.freeUntil && (
                          <span className="mr-2 font-semibold text-[#35C48F]">Free hasta {formatClock(s.freeUntil, s.venue.timezone)} ·</span>
                        )}
                        {s.minPrice !== null && (
                          <span className="text-[var(--ink-muted)]">Desde {formatMoney(s.minPrice, s.ticketTypes[0]!.currency)}</span>
                        )}
                        {!soldOut && s.left <= LOW_STOCK && (
                          <span className="ml-2 font-semibold text-[var(--accent-2)]">¡Últimas {s.left}!</span>
                        )}
                        {s.queueEnabled && <span className="ml-2 text-[var(--accent-text)]">Fila virtual</span>}
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
                          : "text-sm font-semibold text-[var(--accent-text)] transition-transform group-hover:translate-x-1"
                      }
                    >
                      {soldOut ? "Agotado" : "Comprar →"}
                    </span>
                  </>
                );
                return (
                  <li key={s.id}>
                    {soldOut || preview ? (
                      <div className={`flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] px-5 py-4 ${soldOut ? "opacity-60" : ""}`}>
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
