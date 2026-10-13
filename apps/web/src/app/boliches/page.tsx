import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { WEEKDAY_SHORT, formatClock, localWeekday } from "@ticketera/core";
import { ClubOfferView } from "@/components/club-offer";
import { EventImage } from "@/components/event-image";
import { WHEN_LABEL, listClubs, type When } from "@/lib/nightlife";

export const metadata: Metadata = {
  title: "Boliches",
  description: "Discotecas, boliches y lounges de Bolivia: mesas con consumo, free por horario y entradas para cada noche.",
};

type Props = { searchParams: Promise<{ ciudad?: string; cuando?: string }> };

const isWhen = (value: string | undefined): value is When => value === "hoy" || value === "finde" || value === "semana";

export default async function ClubsPage({ searchParams }: Props) {
  await connection();
  const params = await searchParams;
  const when = isWhen(params.cuando) ? params.cuando : undefined;
  const city = params.ciudad?.trim().slice(0, 40) || undefined;
  const { clubs, cities } = await listClubs({ city, when });

  const href = (next: { ciudad?: string | null; cuando?: string | null }) => {
    const qs = new URLSearchParams();
    const c = next.ciudad === undefined ? city : next.ciudad;
    const w = next.cuando === undefined ? when : next.cuando;
    if (c) qs.set("ciudad", c);
    if (w) qs.set("cuando", w);
    const s = qs.toString();
    return s ? `/boliches?${s}` : "/boliches";
  };
  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition-colors ${active ? "border-[#C04BFF] bg-[#C04BFF]/15 font-semibold text-[#d9a6ff]" : "border-[var(--border-light)] text-[var(--ink-muted)] hover:border-[var(--ink-muted)] hover:text-[var(--ink)]"}`;

  return (
    <main>
      <section className="relative overflow-hidden border-b border-[var(--border)]">
        <div
          aria-hidden
          className="absolute inset-0 opacity-70"
          style={{ background: "radial-gradient(60% 80% at 15% 20%, #c04bff55, transparent 70%), radial-gradient(50% 70% at 85% 30%, #ff3d6844, transparent 70%)" }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-14 sm:py-20">
          <p className="eyebrow text-[#d9a6ff]">Noche · Bolivia</p>
          <h1 className="font-display mt-2 max-w-3xl text-5xl leading-[0.95] sm:text-7xl">Boliches y discotecas</h1>
          <p className="mt-4 max-w-2xl text-[var(--ink-muted)]">
            Reserva tu mesa o lounge con consumo incluido, entra free antes de la hora o compra tu entrada con trago. Cada
            persona entra con su QR y el consumo se descuenta en la barra.
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
        <section aria-label="Filtrar" className="space-y-3">
          <nav className="flex flex-wrap gap-2" aria-label="Cuándo">
            <Link href={href({ cuando: null })} className={chip(!when)}>
              Todas las noches
            </Link>
            {(Object.keys(WHEN_LABEL) as When[]).map((w) => (
              <Link key={w} href={href({ cuando: w })} className={chip(when === w)}>
                {WHEN_LABEL[w]}
              </Link>
            ))}
          </nav>
          {cities.length > 1 && (
            <nav className="flex flex-wrap gap-2" aria-label="Ciudad">
              <Link href={href({ ciudad: null })} className={chip(!city)}>
                Todas las ciudades
              </Link>
              {cities.map((c) => (
                <Link key={c} href={href({ ciudad: c })} className={chip(city?.toLowerCase() === c.toLowerCase())}>
                  {c}
                </Link>
              ))}
            </nav>
          )}
        </section>

        {clubs.length === 0 ? (
          <div className="card space-y-3 p-8 text-center">
            <p className="font-display text-2xl">No hay noches con ese filtro</p>
            <Link href="/boliches" className="btn-ghost">
              Ver todas las noches
            </Link>
          </div>
        ) : (
          <ul className="grid gap-6 lg:grid-cols-2">
            {clubs.map((club) => {
              const tz = club.venue.timezone;
              return (
                <li key={club.slug} className="card overflow-hidden">
                  <Link href={`/eventos/${club.slug}`} className="group block">
                    <div className="relative h-48 overflow-hidden bg-[var(--bg-raised)]">
                      <EventImage src={club.imageUrl} title={club.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-raised)] via-transparent to-transparent" />
                      <span className="absolute left-4 top-4 rounded-full bg-[#C04BFF] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                        Boliche
                      </span>
                    </div>
                    <div className="space-y-3 p-5">
                      <div>
                        <h2 className="font-display text-2xl leading-tight group-hover:text-[var(--accent)]">{club.title}</h2>
                        <p className="text-sm text-[var(--ink-muted)]">
                          {club.venue.name}
                          {club.venue.city && ` · ${club.venue.city}`}
                          {club.organizer && ` · ${club.organizer}`}
                        </p>
                      </div>
                      <ClubOfferView offer={club.offer} currency={club.currency} timeZone={tz} />
                    </div>
                  </Link>
                  <div className="border-t border-[var(--border)] px-5 py-4">
                    <p className="eyebrow mb-2">Próximas noches</p>
                    <ul className="flex flex-wrap gap-2">
                      {club.nights.map((n) => {
                        const date = new Intl.DateTimeFormat("es-BO", { timeZone: tz, day: "numeric", month: "short" }).format(n.startsAt);
                        return (
                          <li key={n.id}>
                            {n.left > 0 ? (
                              <Link
                                href={`/comprar/${n.id}`}
                                className="block rounded-lg border border-[var(--border-light)] px-3 py-1.5 text-center text-sm transition-colors hover:border-[#C04BFF] hover:bg-[#C04BFF]/10"
                              >
                                <span className="block font-semibold">
                                  {WEEKDAY_SHORT[localWeekday(n.startsAt, tz)]} {date}
                                </span>
                                <span className="text-xs text-[var(--ink-dim)]">{formatClock(n.startsAt, tz)}</span>
                              </Link>
                            ) : (
                              <span className="block rounded-lg border border-[var(--border)] px-3 py-1.5 text-center text-sm opacity-50">
                                <span className="block font-semibold">
                                  {WEEKDAY_SHORT[localWeekday(n.startsAt, tz)]} {date}
                                </span>
                                <span className="text-xs">Agotado</span>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <section aria-label="Cómo funciona" className="grid gap-6 border-t border-[var(--border)] pt-10 sm:grid-cols-3">
          {[
            ["01", "Elige tu noche", "Cada boliche abre sus noches de la semana: filtra por hoy, este finde o tu ciudad."],
            ["02", "Mesa, free o entrada", "Las mesas traen consumo incluido y un QR por persona; la free vale hasta la hora indicada."],
            ["03", "Consume en la barra", "Muestra cualquier QR de tu mesa en la barra: se descuenta del consumo incluido."],
          ].map(([n, title, text]) => (
            <div key={n} className="flex gap-4">
              <span className="font-display text-4xl leading-none text-[#C04BFF]">{n}</span>
              <div>
                <h3 className="font-display text-lg leading-tight">{title}</h3>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">{text}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
