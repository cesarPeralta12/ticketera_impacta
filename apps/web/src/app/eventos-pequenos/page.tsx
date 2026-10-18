import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CATEGORY_LABEL } from "@ticketera/core";
import { EventStub } from "@/components/home/event-card";
import { listPublishedEvents } from "@/lib/events";

export const metadata: Metadata = {
  title: "Eventos pequeños",
  description: "Peñas, recitales íntimos, obras de teatro y fiestas con pocos cupos en Bolivia: compra tu entrada antes de que se acaben.",
};

type Props = { searchParams: Promise<{ ciudad?: string; categoria?: string }> };

const ACCENT = "#2ec4a0";

export default async function SmallEventsPage({ searchParams }: Props) {
  await connection();
  const params = await searchParams;
  const now = new Date();
  const all = await listPublishedEvents(undefined, undefined, { small: true });

  // Los filtros salen de lo que hay publicado: solo las ciudades y categorías con algún evento pequeño.
  const cities = [...new Set(all.flatMap((e) => (e.nextSession.venue.city ? [e.nextSession.venue.city] : [])))].sort((a, b) => a.localeCompare(b, "es"));
  const categories = [...new Set(all.map((e) => e.category))];
  const city = cities.find((c) => c.toLowerCase() === params.ciudad?.trim().toLowerCase());
  const category = categories.find((c) => c.toLowerCase() === params.categoria?.trim().toLowerCase());
  const events = all.filter((e) => (!city || e.nextSession.venue.city === city) && (!category || e.category === category));

  const href = (next: { ciudad?: string | null; categoria?: string | null }) => {
    const qs = new URLSearchParams();
    const c = next.ciudad === undefined ? city : next.ciudad;
    const k = next.categoria === undefined ? category : next.categoria;
    if (c) qs.set("ciudad", c);
    if (k) qs.set("categoria", k.toLowerCase());
    const s = qs.toString();
    return s ? `/eventos-pequenos?${s}` : "/eventos-pequenos";
  };
  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition-colors ${active ? "border-[#2ec4a0] bg-[#2ec4a0]/15 font-semibold text-[#5fe0bd]" : "border-[var(--border-light)] text-[var(--ink-muted)] hover:border-[var(--ink-muted)] hover:text-[var(--ink)]"}`;

  return (
    <main>
      <section className="relative overflow-hidden border-b border-[var(--border)]">
        <div
          aria-hidden
          className="absolute inset-0 opacity-70"
          style={{ background: `radial-gradient(60% 80% at 15% 20%, ${ACCENT}55, transparent 70%), radial-gradient(50% 70% at 85% 30%, #f5b70033, transparent 70%)` }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-14 sm:py-20">
          <p className="eyebrow text-[#5fe0bd]">Cerca · Pocos cupos</p>
          <h1 className="font-display mt-2 max-w-3xl text-5xl leading-[0.95] sm:text-7xl">Eventos pequeños</h1>
          <p className="mt-4 max-w-2xl text-[var(--ink-muted)]">
            Peñas, recitales íntimos, obras de teatro y fiestas con pocos lugares. Compra tu entrada con tu cuenta y entra con el QR de
            tu celular, igual que en los grandes.
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
        {(cities.length > 1 || categories.length > 1) && (
          <section aria-label="Filtrar" className="space-y-3">
            {categories.length > 1 && (
              <nav className="flex flex-wrap gap-2" aria-label="Categoría">
                <Link href={href({ categoria: null })} className={chip(!category)}>
                  Todos
                </Link>
                {categories.map((c) => (
                  <Link key={c} href={href({ categoria: c })} className={chip(category === c)}>
                    {CATEGORY_LABEL[c]}
                  </Link>
                ))}
              </nav>
            )}
            {cities.length > 1 && (
              <nav className="flex flex-wrap gap-2" aria-label="Ciudad">
                <Link href={href({ ciudad: null })} className={chip(!city)}>
                  Todas las ciudades
                </Link>
                {cities.map((c) => (
                  <Link key={c} href={href({ ciudad: c })} className={chip(city === c)}>
                    {c}
                  </Link>
                ))}
              </nav>
            )}
          </section>
        )}

        {events.length === 0 ? (
          <div className="card space-y-3 p-8 text-center">
            <p className="font-display text-2xl">{all.length === 0 ? "Pronto habrá eventos pequeños aquí" : "No hay eventos pequeños con ese filtro"}</p>
            <Link href={all.length === 0 ? "/" : "/eventos-pequenos"} className="btn-ghost">
              {all.length === 0 ? "Ver todos los eventos" : "Ver todos los eventos pequeños"}
            </Link>
          </div>
        ) : (
          <section aria-label="Eventos pequeños" className="space-y-5">
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
