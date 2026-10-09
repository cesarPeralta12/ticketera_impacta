export type PromoStateInfo = { text: string; className: string };

/** Estado de un código a simple vista. */
export function promoState(
  p: { active: boolean; startsAt: Date | null; endsAt: Date | null; maxUses: number | null; uses: number },
  now: Date,
): PromoStateInfo {
  if (!p.active) return { text: "Desactivado", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" };
  if (p.endsAt && p.endsAt <= now) return { text: "Vencido", className: "bg-[var(--danger-soft)] text-[var(--danger)]" };
  if (p.maxUses !== null && p.uses >= p.maxUses) return { text: "Agotado", className: "bg-[var(--warn-soft)] text-[var(--warn)]" };
  if (p.startsAt && p.startsAt > now) return { text: "Programado", className: "bg-[var(--warn-soft)] text-[var(--warn)]" };
  return { text: "Activo", className: "bg-[var(--accent-soft)] text-[var(--accent)]" };
}

