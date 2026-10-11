"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Badge } from "@ticketera/core";
import { EventImage } from "@/components/event-image";

export type HeroSlide = {
  slug: string;
  title: string;
  imageUrl: string | null;
  category: string;
  categoryColor: string;
  /** "jue, 29 oct 2026, 21:00" */
  when: string;
  venue: string;
  /** "Hoy", "Mañana", "En 5 días" */
  soon: string | null;
  price: string | null;
  listPrice: string | null;
  badges: Badge[];
  /** "Preventa hasta 20 oct · Quedan 5 días" */
  offer: string | null;
  stickerPercent: number | null;
};

const SLIDE_MS = 7000;

/**
 * Carrusel principal de la portada: los eventos que más conviene mostrar (preventas y descuentos por terminar,
 * los que se agotan, los más próximos). Cambia solo cada 7 s, se detiene al pasar el cursor, al enfocar con el
 * teclado o con la pestaña oculta, y no se mueve solo si la persona pidió menos animación. Se desliza con el dedo.
 */
export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(false);
  const touchStart = useRef<number | null>(null);
  const count = slides.length;

  const go = useCallback((to: number) => setIndex(((to % count) + count) % count), [count]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    const frame = requestAnimationFrame(sync);
    query.addEventListener("change", sync);
    const visibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      query.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  const paused = hovered || focused || hidden || reduced || count < 2;

  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), SLIDE_MS);
    return () => clearTimeout(id);
  }, [index, paused, count]);

  if (count === 0) return null;

  return (
    <section
      className="relative isolate h-[80svh] max-h-[46rem] min-h-[31rem] w-full overflow-hidden bg-[var(--bg)]"
      role="region"
      aria-roledescription="carrusel"
      aria-label="Eventos destacados"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(index + 1);
        if (e.key === "ArrowLeft") go(index - 1);
      }}
      onTouchStart={(e) => (touchStart.current = e.touches[0]!.clientX)}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (start === null) return;
        const dx = e.changedTouches[0]!.clientX - start;
        if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
      }}
    >
      {slides.map((s, i) => {
        const active = i === index;
        return (
          <article
            key={s.slug}
            className="hero-slide absolute inset-0"
            data-active={active}
            aria-hidden={!active}
            inert={!active}
            role="group"
            aria-roledescription="diapositiva"
            aria-label={`${i + 1} de ${count}: ${s.title}`}
          >
            <div className="absolute inset-0 overflow-hidden">
              <EventImage src={s.imageUrl} title={s.title} eager={i === 0} className="hero-img h-full w-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg)] via-[var(--bg)]/75 to-[var(--bg)]/10" />
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/20 to-transparent" />

            <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col justify-end px-6 pb-24 sm:pb-28">
              <div className="hero-rise max-w-3xl space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wide" style={{ background: s.categoryColor, color: "#0b0b10" }}>
                    {s.category}
                  </span>
                  {s.soon && <span className="tag tag-soon">{s.soon}</span>}
                  {s.badges.map((b) => (
                    <span key={b.kind} className={`tag tag-${b.kind}`}>
                      {b.text}
                    </span>
                  ))}
                </div>

                <h2 className="font-display text-[clamp(2.7rem,9vw,6.75rem)] leading-[0.9] text-[var(--ink)]">{s.title}</h2>

                <p className="text-base text-[var(--ink)]/85 sm:text-lg">
                  <span className="capitalize">{s.when}</span> · {s.venue}
                </p>

                {s.offer && (
                  <p className="inline-flex items-center gap-2 rounded-lg border border-[var(--accent)]/50 bg-[var(--accent)]/10 px-3 py-1.5 text-sm font-semibold text-[var(--accent)]">
                    <span aria-hidden>★</span> {s.offer}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
                  <Link href={`/eventos/${s.slug}`} className="btn-accent px-7 py-3 text-base" tabIndex={active ? 0 : -1}>
                    Comprar entradas
                  </Link>
                  {s.price && (
                    <p className="leading-tight">
                      <span className="block text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">Desde</span>
                      <span className="flex items-baseline gap-2">
                        <span className="font-display text-3xl text-[var(--accent)]">{s.price}</span>
                        {s.listPrice && <span className="text-sm text-[var(--ink-dim)] line-through">{s.listPrice}</span>}
                      </span>
                    </p>
                  )}
                  {s.stickerPercent ? (
                    <span className="sticker hidden sm:grid" aria-label={`${s.stickerPercent}% de descuento`}>
                      -{s.stickerPercent}%
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </article>
        );
      })}

      {count > 1 && (
        <div className="absolute inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-6xl items-center gap-4 px-6 pb-7">
          <ol className="flex flex-1 gap-2" aria-label="Elegir diapositiva">
            {slides.map((s, i) => (
              <li key={s.slug} className="flex-1">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Ver ${s.title}`}
                  aria-current={i === index}
                  className="group block w-full py-2"
                >
                  <span className="relative block h-[3px] overflow-hidden rounded-full bg-white/20">
                    {i < index && <span className="absolute inset-0 bg-white/70" />}
                    {i === index && (
                      <span
                        key={`${index}-${paused ? "p" : "r"}`}
                        className="hero-progress absolute inset-0 bg-[var(--accent)]"
                        style={{ ["--hero-ms" as string]: `${SLIDE_MS}ms`, animationPlayState: paused ? "paused" : "running", ...(reduced ? { transform: "scaleX(1)" } : {}) }}
                      />
                    )}
                  </span>
                  <span className="mt-2 hidden truncate text-left text-[11px] font-semibold uppercase tracking-wide text-white/55 group-hover:text-white sm:block">
                    {s.title}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="hidden gap-2 sm:flex">
            <button
              type="button"
              aria-label="Anterior"
              onClick={() => go(index - 1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/30 text-lg backdrop-blur hover:border-[var(--accent)]"
            >
              ←
            </button>
            <button
              type="button"
              aria-label="Siguiente"
              onClick={() => go(index + 1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/30 text-lg backdrop-blur hover:border-[var(--accent)]"
            >
              →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
