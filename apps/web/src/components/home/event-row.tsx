"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Fila de eventos que se desliza (dedo en el celular, flechas en la computadora). Cada tarjeta queda
 * "pegada" al borde al soltar. Las flechas se apagan en los extremos.
 */
export function EventRow({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Color del título destacado (por ejemplo, rosa para ofertas). */
  accent?: string;
  children: ReactNode;
}) {
  const track = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const frame = requestAnimationFrame(measure);
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  function scrollBy(direction: 1 | -1) {
    const el = track.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  }

  const arrow = "hidden h-10 w-10 items-center justify-center rounded-full border border-[var(--border-light)] bg-[var(--bg-raised)] text-lg transition-opacity hover:border-[var(--accent)] disabled:opacity-25 sm:flex";

  return (
    <section className="space-y-4" aria-label={title}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl leading-none sm:text-3xl" style={accent ? { color: accent } : undefined}>
            {title}
          </h2>
          {subtitle && <p className="mt-1.5 text-sm text-[var(--ink-muted)]">{subtitle}</p>}
        </div>
        <div className="flex gap-2">
          <button type="button" aria-label={`${title}: anteriores`} className={arrow} disabled={edge.start} onClick={() => scrollBy(-1)}>
            ←
          </button>
          <button type="button" aria-label={`${title}: siguientes`} className={arrow} disabled={edge.end} onClick={() => scrollBy(1)}>
            →
          </button>
        </div>
      </div>
      <ul
        ref={track}
        className="no-scrollbar -mx-6 flex snap-x snap-mandatory scroll-pl-6 gap-4 overflow-x-auto scroll-smooth px-6 pb-2 [&>li]:w-[78%] [&>li]:shrink-0 [&>li]:snap-start sm:[&>li]:w-[44%] lg:[&>li]:w-[31.5%]"
      >
        {children}
      </ul>
    </section>
  );
}
