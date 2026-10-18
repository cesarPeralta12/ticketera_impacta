import Link from "next/link";
import type { EventCheck } from "@/lib/event-checklist";

/** Lista de lo que falta para publicar (✓ listo, ! obligatorio, ○ recomendado), con el enlace para completarlo. */
export function EventChecklist({ checks, readOnly }: { checks: EventCheck[]; readOnly: boolean }) {
  return (
    <ul className="space-y-2 text-sm">
      {checks.map((c) => (
        <li key={c.text} className="flex items-start gap-2">
          <span
            aria-hidden
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
              c.done
                ? "bg-[var(--accent)] text-white"
                : c.required
                  ? "border border-[var(--warn)] text-[var(--warn)]"
                  : "border border-[var(--border)] text-[var(--ink-dim)]"
            }`}
          >
            {c.done ? "✓" : c.required ? "!" : ""}
          </span>
          <span className="flex-1">
            <span className={c.done ? "text-[var(--ink-muted)]" : ""}>{c.text}</span>
            {!c.done && (
              <>
                <span className="text-xs text-[var(--ink-dim)]"> · {c.required ? "falta" : "recomendado"}</span>
                {/* Una cuenta de solo lectura ve qué falta, pero lo completa Impacta. */}
                {!readOnly && (
                  <>
                    <span className="text-xs text-[var(--ink-dim)]"> · </span>
                    <Link href={c.href} className="text-xs text-[var(--accent)] hover:underline">
                      {c.action}
                    </Link>
                  </>
                )}
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
