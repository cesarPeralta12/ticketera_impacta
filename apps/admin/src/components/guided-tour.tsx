"use client";

import { useEffect, useState } from "react";

const KEY = "impacta-recorrido-v1";

export type TourStep = { title: string; text: string; href?: string; target?: string };

/**
 * Recorrido guiado la primera vez que alguien entra al panel (en este navegador): unos pasos que señalan el menú.
 * Se puede volver a ver desde "Ver el recorrido" en el menú.
 */
export function GuidedTour({ steps }: { steps: TourStep[] }) {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(KEY) === "1";
    } catch {
      /* sin almacenamiento (ventana privada): no se muestra solo */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se decide una vez, al cargar en el navegador
    if (!seen) setStep(0);
    const replay = () => setStep(0);
    window.addEventListener("impacta:recorrido", replay);
    return () => window.removeEventListener("impacta:recorrido", replay);
  }, []);

  // Resalta en el menú la sección del paso (o el elemento que el paso señala, como el buscador).
  const current = step === null ? undefined : steps[step];
  const selector = current?.target ?? (current?.href ? `aside a[href="${current.href}"]` : undefined);
  useEffect(() => {
    if (!selector) return;
    const link = document.querySelector<HTMLElement>(selector);
    link?.classList.add("tour-target");
    link?.scrollIntoView({ block: "nearest" });
    return () => link?.classList.remove("tour-target");
  }, [selector]);

  function close() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* nada */
    }
    setStep(null);
  }

  if (step === null || !current) return null;
  const last = step === steps.length - 1;
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="recorrido-titulo" className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl print:hidden">
      <p className="eyebrow">
        Recorrido · {step + 1} de {steps.length}
      </p>
      <h2 id="recorrido-titulo" className="mt-1 text-base font-semibold">
        {current.title}
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">{current.text}</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" onClick={close} className="text-xs text-[var(--ink-dim)] hover:text-[var(--ink)]">
          Saltar
        </button>
        <div className="flex gap-2">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="btn px-3 py-1 text-xs">
              Atrás
            </button>
          )}
          <button type="button" onClick={() => (last ? close() : setStep(step + 1))} className="btn btn-primary px-3 py-1 text-xs">
            {last ? "Listo" : "Siguiente"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Botón para volver a ver el recorrido. */
export function TourReplay() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("impacta:recorrido"))} className="hidden text-xs text-[var(--side-dim)] hover:text-[var(--side-ink)] md:block">
      Ver el recorrido
    </button>
  );
}
