"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

const KEY = "impacta-recorrido-v2";
const CARD_WIDTH = 360;
const GAP = 14;
/** Cuánto se espera a que aparezca lo que se quiere mostrar (la página puede tardar en cargar). */
const FIND_TIMEOUT_MS = 4000;

export type TourStep = {
  title: string;
  text: string;
  /** Página que se abre en este paso (el recorrido lleva a la persona hasta ahí). */
  href?: string;
  /** Qué se ilumina (selector CSS). Sin esto: el enlace del menú de `href`. */
  target?: string;
  /** Lo que conviene saber de esa pantalla, en frases cortas. */
  points?: string[];
};

type Rect = { top: number; left: number; width: number; height: number };

const samePage = (href: string, pathname: string, search: string) => {
  const [path, query = ""] = href.split("?");
  return path === pathname && (query === "" || search.replace(/^\?/, "") === query);
};

/**
 * Recorrido guiado: la primera vez que alguien entra al panel (en este navegador) lo lleva por las secciones
 * principales, abre cada página e ilumina lo importante con una tarjeta que lo explica. Se puede avanzar con las
 * flechas del teclado, saltar a cualquier paso y volver a verlo desde "Ver el recorrido" en el menú.
 *
 * - `storageKey`: dónde se recuerda que ya se vio (sin clave, no se abre solo).
 * - `event`: el evento de la ventana que lo abre de nuevo.
 * - `finishHref`: a dónde lleva al terminar (sin destino, se queda en la pantalla).
 */
export function GuidedTour({
  steps,
  storageKey = KEY,
  event = "impacta:recorrido",
  finishHref = "/",
}: {
  steps: TourStep[];
  storageKey?: string | null;
  event?: string;
  finishHref?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [mobile, setMobile] = useState(false);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let seen = true;
    try {
      seen = !storageKey || localStorage.getItem(storageKey) === "1";
    } catch {
      /* sin almacenamiento (ventana privada): no se muestra solo */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se decide una vez, al cargar en el navegador
    if (!seen) setStep(0);
    const replay = () => setStep(0);
    window.addEventListener(event, replay);
    return () => window.removeEventListener(event, replay);
  }, [storageKey, event]);

  const close = useCallback(() => {
    try {
      if (storageKey) localStorage.setItem(storageKey, "1");
    } catch {
      /* nada */
    }
    setStep(null);
    setRect(null);
    targetRef.current = null;
  }, [storageKey]);

  const current = step === null ? undefined : steps[step];

  // Lleva a la página del paso.
  useEffect(() => {
    if (!current?.href) return;
    if (!samePage(current.href, pathname, window.location.search)) router.push(current.href);
  }, [current, pathname, router]);

  // Busca lo que se ilumina (espera a que la página lo muestre) y lo trae a la vista.
  useEffect(() => {
    if (!current) return;
    const selector = current.target ?? (current.href ? `aside a[href="${current.href}"]` : null);
    targetRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- al cambiar de paso se apaga el foco anterior hasta encontrar el nuevo
    setRect(null);
    if (!selector) return;
    const began = Date.now();
    let timer = 0;
    const look = () => {
      const el = document.querySelector<HTMLElement>(selector);
      const onPage = !current.href || samePage(current.href, window.location.pathname, window.location.search) || selector.startsWith("aside");
      if (el && onPage && el.getBoundingClientRect().width > 0) {
        targetRef.current = el;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (Date.now() - began < FIND_TIMEOUT_MS) timer = window.setTimeout(look, 120);
    };
    look();
    return () => window.clearTimeout(timer);
  }, [current, pathname]);

  // Sigue al elemento iluminado (scroll, cambios de tamaño, la página que termina de cargar).
  useLayoutEffect(() => {
    if (step === null) return;
    let frame = 0;
    const update = () => {
      setMobile(window.innerWidth < 640);
      const el = targetRef.current;
      if (el?.isConnected) {
        const r = el.getBoundingClientRect();
        setRect((prev) =>
          prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height },
        );
      }
    };
    const follow = () => {
      update();
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    // También con el scroll y al cambiar el tamaño: si el navegador frena los cuadros (pestaña de fondo), igual sigue.
    window.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, [step]);

  // Teclado: → o Enter avanza, ← vuelve, Esc cierra.
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setStep((s) => (s === null ? s : Math.min(steps.length - 1, s + 1)));
      else if (e.key === "ArrowLeft") setStep((s) => (s === null ? s : Math.max(0, s - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, steps.length, close]);

  if (step === null || !current) return null;
  const last = step === steps.length - 1;
  const pad = 6;
  const spot = rect && { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };

  // La tarjeta va al lado de lo iluminado si entra; si no, abajo o arriba; en el celular, abajo de la pantalla.
  let cardStyle: CSSProperties = { right: 16, bottom: 16 };
  if (spot && !mobile && typeof window !== "undefined") {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estimated = 300;
    const clampTop = (t: number) => Math.max(16, Math.min(t, vh - estimated - 16));
    const clampLeft = (l: number) => Math.max(16, Math.min(l, vw - CARD_WIDTH - 16));
    if (spot.left + spot.width + GAP + CARD_WIDTH < vw - 8) cardStyle = { top: clampTop(spot.top), left: spot.left + spot.width + GAP };
    else if (spot.top + spot.height + GAP + estimated < vh) cardStyle = { top: spot.top + spot.height + GAP, left: clampLeft(spot.left) };
    else if (spot.top - GAP - estimated > 0) cardStyle = { top: spot.top - GAP - estimated, left: clampLeft(spot.left) };
  }

  return (
    <div className="print:hidden" aria-live="polite">
      {/* Oscurece la página y deja a la vista lo que se explica. No bloquea: se puede seguir usando el panel. */}
      {spot ? (
        <div aria-hidden className="tour-spot" style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />
      ) : (
        <div aria-hidden className="tour-dim" />
      )}
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="recorrido-titulo"
        className="tour-card fixed z-[61] w-[min(22.5rem,calc(100vw-2rem))] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl max-sm:!bottom-4 max-sm:!left-4 max-sm:!right-4 max-sm:!top-auto"
        style={cardStyle}
      >
        <div key={step} className="tour-step">
          <div className="flex items-center justify-between">
            <p className="eyebrow">
              Recorrido · {step + 1} de {steps.length}
            </p>
            <button type="button" onClick={close} aria-label="Cerrar el recorrido" className="text-lg leading-none text-[var(--ink-dim)] hover:text-[var(--ink)]">
              ×
            </button>
          </div>
          <h2 id="recorrido-titulo" className="mt-1 text-lg font-semibold">
            {current.title}
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{current.text}</p>
          {current.points && current.points.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {current.points.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 h-1 overflow-hidden rounded-full bg-[var(--surface-2)]" aria-hidden>
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${((step + 1) / steps.length) * 100}%`, background: "var(--grad-brand)" }} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Pasos del recorrido">
            {steps.map((s, i) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                aria-selected={i === step}
                aria-label={`Paso ${i + 1}: ${s.title}`}
                onClick={() => setStep(i)}
                className={`h-2 rounded-full transition-all ${i === step ? "w-5 bg-[var(--accent)]" : "w-2 bg-[var(--border)] hover:bg-[var(--ink-dim)]"}`}
              />
            ))}
          </div>
          <div className="flex shrink-0 gap-2">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="btn px-3 py-1 text-xs">
                Atrás
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (!last) return setStep(step + 1);
                close();
                if (finishHref && pathname !== finishHref) router.push(finishHref);
              }}
              className="btn btn-primary px-3 py-1 text-xs"
            >
              {last ? "Terminar" : "Siguiente →"}
            </button>
          </div>
        </div>
        <p className="mt-2 hidden text-[11px] text-[var(--ink-dim)] sm:block">Usa ← → del teclado. Esc cierra.</p>
      </div>
    </div>
  );
}

/**
 * Recorrido de una sola pantalla: un botón (al lado del título) que ilumina sus partes una por una. No se abre solo:
 * lo pide quien lo necesita, y al terminar se queda en la misma pantalla.
 */
export function PageTour({ id, steps }: { id: string; steps: TourStep[] }) {
  const event = `impacta:recorrido:${id}`;
  return (
    <>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(event))}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent-hover)] transition-colors hover:border-[var(--accent)] print:hidden"
      >
        <span aria-hidden>▶</span> Ver recorrido
      </button>
      <GuidedTour steps={steps} storageKey={null} event={event} finishHref={null} />
    </>
  );
}

/** Botón para volver a ver el recorrido. */
export function TourReplay() {
  return (
    <button
      type="button"
      data-tour="replay"
      onClick={() => window.dispatchEvent(new Event("impacta:recorrido"))}
      className="hidden text-xs text-[var(--side-dim)] hover:text-[var(--side-ink)] md:block"
    >
      Ver el recorrido
    </button>
  );
}
