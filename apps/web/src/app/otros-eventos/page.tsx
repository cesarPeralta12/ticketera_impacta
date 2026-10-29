import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CATEGORY_LABEL } from "@ticketera/core";
import { EventStub } from "@/components/home/event-card";
import { listPublishedEvents } from "@/lib/events";

export const metadata: Metadata = {
  title: "Otros eventos",
  description: "Peñas, recitales, obras, ferias y fiestas en Bolivia. Compra tu entrada y entra con el QR de tu celular.",
};

type Props = { searchParams: Promise<{ ciudad?: string; categoria?: string }> };

/**
 * «Otros eventos»: los que el panel marca como evento pequeño (peñas, recitales íntimos, obras, ferias). En la web
 * nunca se dice "pequeño": es una sección más, con filtro por ciudad y por tipo.
 */
export default async function OtherEventsPage({ searchParams }: Props) {
  await connection();
  const params = await searchParams;
  const now = new Date();
  const all = await listPublishedEvents(undefined, undefined, { small: true });

  // Las ciudades y los tipos salen de lo que hay publicado.
  const cities = [...new Set(all.flatMap((e) => (e.nextSession.venue.city ? [e.nextSession.venue.city] : [])))].sort((a, b) => a.localeCompare(b, "es"));
  const city = cities.find((c) => c.toLowerCase() === params.ciudad?.trim().toLowerCase());
  const categories = [...new Set(all.map((e) => e.category))];
  const category = categories.find((c) => c === params.categoria?.toUpperCase());
  const events = all.filter((e) => (!city || e.nextSession.venue.city === city) && (!category || e.category === category));

  const href = (next: { ciudad?: string; categoria?: string }) => {
    const qs = new URLSearchParams(Object.entries(next).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return qs.size ? `/otros-eventos?${qs}` : "/otros-eventos";
  };
  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition-colors ${active ? "border-[var(--highlight)] bg-[var(--highlight)]/15 font-semibold text-[var(--highlight)]" : "border-[var(--border-light)] text-[var(--ink-muted)] hover:border-[var(--ink-muted)] hover:text-[var(--ink)]"}`;

  return (
    <main>
      <section className="relative overflow-hidden border-b border-[var(--border)]">
        <div
          aria-hidden
          className="absolute inset-0 opacity-70"
          style={{ background: "radial-gradient(60% 80% at 15% 20%, #F5B70044, transparent 70%), radial-gradient(50% 70% at 85% 30%, #AD468D55, transparent 70%)" }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-14 sm:py-20">
          <p className="eyebrow text-[var(--highlight)]">Peñas · Recitales · Obras · Ferias</p>
          <h1 className="font-display mt-2 max-w-3xl text-5xl leading-[0.95] sm:text-7xl">Otros eventos</h1>
          <p className="mt-4 max-w-2xl text-[var(--ink-muted)]">
            Planes cerca tuyo para esta semana y las que vienen. Compra tu entrada con tu cuenta y entra con el QR de tu celular.
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
        {(cities.length > 1 || categories.length > 1) && (
          <div className="space-y-3">
            {cities.length > 1 && (
              <nav className="flex flex-wrap gap-2" aria-label="Ciudad">
                <Link href={href({ categoria: category?.toLowerCase() })} className={chip(!city)}>
                  Todas las ciudades
                </Link>
                {cities.map((c) => (
                  <Link key={c} href={href({ ciudad: c, categoria: category?.toLowerCase() })} className={chip(city === c)}>
                    {c}
                  </Link>
                ))}
              </nav>
            )}
            {categories.length > 1 && (
              <nav className="flex flex-wrap gap-2" aria-label="Tipo de evento">
                <Link href={href({ ciudad: city })} className={chip(!category)}>
                  Todos
                </Link>
                {categories.map((c) => (
                  <Link key={c} href={href({ ciudad: city, categoria: c.toLowerCase() })} className={chip(category === c)}>
                    {CATEGORY_LABEL[c] ?? "Evento"}
                  </Link>
                ))}
              </nav>
            )}
          </div>
        )}

        {events.length === 0 ? (
          <div className="card space-y-3 p-8 text-center">
            <p className="font-display text-2xl">{all.length === 0 ? "Pronto habrá más eventos aquí" : "No hay eventos con ese filtro"}</p>
            <Link href={all.length === 0 ? "/" : "/otros-eventos"} className="btn-ghost">
              {all.length === 0 ? "Ver todos los eventos" : "Ver todos"}
            </Link>
          </div>
        ) : (
          <section aria-label="Otros eventos" className="space-y-5">
            <p className="text-sm text-[var(--ink-muted)]">
              {events.length} {events.length === 1 ? "evento" : "eventos"}, del más próximo al más lejano
            </p>
            <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((e, i) => (
                <li key={e.slug} style={{ animation: `fade-up 0.5s ease-out ${Math.min(i, 8) * 50}ms both` }}>
                  <EventStub event={e} now={now} eager={i < 3} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
