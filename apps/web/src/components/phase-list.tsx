import { currentPrice, formatDateTime, formatMoney, type DiscountWindow, type PhaseInfo } from "@ticketera/core";

type PhasedType = DiscountWindow & {
  id: string;
  name: string;
  sectionId: string | null;
  section?: { name: string } | null;
  unitAmount: number;
  currency: string;
  phaseStartsAt: Date | null;
  salesStartAt: Date | null;
  phase: PhaseInfo | null;
};

/** Las fases de cada sección, en orden. Vacío si la función no tiene fases. */
export function phaseChains<T extends PhasedType>(types: T[]) {
  const phased = types.filter((t) => t.phase);
  return [...new Set(phased.map((t) => t.sectionId))].map((sectionId) =>
    phased.filter((t) => t.sectionId === sectionId).toSorted((a, b) => a.phase!.position - b.phase!.position),
  );
}

/**
 * El recuadro "Fases" que ve el comprador: todas las fases de venta con su precio, cuál se vende ahora y cuándo
 * empiezan las que siguen. Solo se compra la fase de ahora.
 */
export function PhaseList({
  types,
  remaining,
  timeZone,
  now = new Date(),
}: {
  types: PhasedType[];
  remaining: Map<string, number>;
  timeZone: string;
  now?: Date;
}) {
  const chains = phaseChains(types);
  if (chains.length === 0) return null;
  return (
    <section className="card overflow-hidden" aria-labelledby="fases-titulo">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 id="fases-titulo" className="font-display text-xl">
          Fases
        </h2>
        <p className="text-xs text-[var(--ink-dim)]">Se vende una fase a la vez: cuando se agota, empieza la siguiente con su precio.</p>
      </div>
      {chains.map((chain) => (
        <div key={chain[0]!.id}>
          {chains.length > 1 && <p className="eyebrow px-5 pt-4">{chain[0]!.section?.name ?? "Entradas"}</p>}
          <ol className="divide-y divide-[var(--border)]">
            {chain.map((t) => {
              const phase = t.phase!;
              const soldOut = (remaining.get(t.id) ?? 0) <= 0;
              const active = phase.state === "active";
              return (
                <li key={t.id} className={`flex items-center gap-4 px-5 py-3 ${active ? "bg-[var(--highlight)]/10" : ""} ${phase.state === "done" ? "opacity-55" : ""}`}>
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm ${active ? "bg-[var(--highlight)] text-[#192438]" : "border border-[var(--border)] text-[var(--ink-muted)]"}`}
                  >
                    {phase.position}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block font-semibold ${phase.state === "done" ? "line-through" : ""}`}>{t.name}</span>
                    <span className="block text-xs text-[var(--ink-dim)]">
                      {active
                        ? soldOut
                          ? "Agotada"
                          : t.salesStartAt && t.salesStartAt > now
                            ? `A la venta desde el ${formatDateTime(t.salesStartAt, timeZone)}`
                            : "A la venta ahora"
                        : phase.state === "done"
                          ? soldOut
                            ? "Agotada"
                            : "Terminada"
                          : t.phaseStartsAt && t.phaseStartsAt > now
                            ? `Próximamente · desde el ${formatDateTime(t.phaseStartsAt, timeZone)} o al agotarse la anterior`
                            : "Próximamente · cuando se agote la anterior"}
                    </span>
                  </span>
                  <span className={`font-display text-lg ${active ? "text-[var(--accent-text)]" : "text-[var(--ink-muted)]"}`}>
                    {formatMoney(currentPrice(t, now).unitAmount, t.currency)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </section>
  );
}
