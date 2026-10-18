import Link from "next/link";

export const WIZARD_STEPS = [
  { key: "datos", label: "Datos" },
  { key: "lugar", label: "Lugar y fecha" },
  { key: "entradas", label: "Entradas" },
  { key: "revisar", label: "Revisar" },
  { key: "publicar", label: "Publicar" },
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number]["key"];

/** Los 5 pasos para armar un evento, con el actual marcado. Los anteriores se pueden volver a abrir. */
export function WizardSteps({ eventId, current }: { eventId?: string; current: WizardStep }) {
  const index = WIZARD_STEPS.findIndex((s) => s.key === current);
  const href = (key: WizardStep) => (!eventId ? null : key === "datos" ? `/eventos/${eventId}?tab=configuracion` : `/eventos/${eventId}/asistente/${key}`);
  return (
    <nav aria-label="Pasos para armar el evento">
      <ol className="flex flex-wrap gap-2 text-sm">
        {WIZARD_STEPS.map((step, i) => {
          const state = i < index ? "done" : i === index ? "current" : "next";
          const link = href(step.key);
          const content = (
            <>
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  state === "done"
                    ? "bg-[var(--accent)] text-white"
                    : state === "current"
                      ? "border-2 border-[var(--accent)] text-[var(--accent)]"
                      : "border border-[var(--border)] text-[var(--ink-dim)]"
                }`}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className={state === "current" ? "font-semibold" : state === "next" ? "text-[var(--ink-dim)]" : ""}>{step.label}</span>
            </>
          );
          return (
            <li key={step.key} aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-2">
              {link && state !== "current" ? (
                <Link href={link} className="flex items-center gap-2 rounded-full px-1 hover:bg-[var(--surface-2)]">
                  {content}
                </Link>
              ) : (
                <span className="flex items-center gap-2 px-1">{content}</span>
              )}
              {i < WIZARD_STEPS.length - 1 && <span aria-hidden className="text-[var(--ink-dim)]">→</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
