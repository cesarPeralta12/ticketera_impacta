/**
 * Fases de venta (Fase Hot, Fase 1, Fase 2…): precios de una misma sección que se venden uno después del otro.
 *
 * - En cada sección se vende una sola fase a la vez.
 * - La siguiente toma el lugar cuando la anterior se agota o cuando llega su fecha (lo primero que pase).
 * - No hay vuelta atrás: si ya se vendió (o se reservó) algo de una fase, las anteriores quedan terminadas aunque una
 *   reserva vencida les devuelva un lugar.
 *
 * Puro (sin base de datos): lo usan la web, la boletería, el panel y la validación de la compra con los mismos números.
 */
import type { SaleWindow } from "./sale-window";

/** Hasta 8 fases por sección (Fase Hot, Fase 1… Fase 7). */
export const MAX_PHASES = 8;

export type PhaseState = "active" | "upcoming" | "done";

/** Lo que hace falta de un precio para saber su fase. */
export type PhaseInput = { id: string; sectionId: string | null; phaseOrder: number | null; phaseStartsAt: Date | null };

export type PhaseInfo = {
  state: PhaseState;
  /** 1, 2, 3… dentro de su sección. */
  position: number;
  total: number;
  /** Cuándo empieza (si tiene fecha); si no, empieza al agotarse la anterior. */
  startsAt: Date | null;
};

/** Lo que se vendió o reservó de cada precio y cuánto le queda. */
export type PhaseStock = { used: Map<string, number>; remaining: Map<string, number> };

/** Una fecha que nunca llega: así una fase que espera a que se agote la anterior figura como "todavía no". */
const NEVER = new Date(8.64e15);

/** Estado de cada precio que es fase (por id). Los precios comunes no aparecen. */
export function phaseStates(types: PhaseInput[], stock: PhaseStock, now: Date = new Date()): Map<string, PhaseInfo> {
  const bySection = new Map<string, PhaseInput[]>();
  for (const t of types) {
    if (t.phaseOrder === null) continue;
    const key = t.sectionId ?? `sin-seccion:${t.id}`;
    bySection.set(key, [...(bySection.get(key) ?? []), t]);
  }
  const states = new Map<string, PhaseInfo>();
  for (const group of bySection.values()) {
    const phases = group.toSorted((a, b) => a.phaseOrder! - b.phaseOrder!);
    const lastWhere = (test: (t: PhaseInput, i: number) => boolean) => phases.reduce((found, t, i) => (test(t, i) ? i : found), 0);
    // Arranca en la última que ya empezó por fecha o que ya tiene ventas; de ahí avanza mientras esté agotada.
    let active = Math.max(
      lastWhere((t, i) => i > 0 && t.phaseStartsAt !== null && t.phaseStartsAt <= now),
      lastWhere((t) => (stock.used.get(t.id) ?? 0) > 0),
    );
    while (active < phases.length - 1 && (stock.remaining.get(phases[active]!.id) ?? 0) <= 0) active++;
    phases.forEach((t, i) =>
      states.set(t.id, {
        state: i < active ? "done" : i === active ? "active" : "upcoming",
        position: i + 1,
        total: phases.length,
        startsAt: i === 0 ? null : t.phaseStartsAt,
      }),
    );
  }
  return states;
}

/**
 * Los precios con su ventana de venta ajustada a las fases, para que `saleState` responda bien en cualquier lado: una
 * fase terminada queda cerrada y una que todavía no empieza, programada (para su fecha, o para nunca si espera a que
 * se agote la anterior). Cada uno lleva su `phase` (o null si es un precio común).
 */
export function withPhases<T extends PhaseInput & SaleWindow>(types: T[], stock: PhaseStock, now: Date = new Date()): (T & { phase: PhaseInfo | null })[] {
  const states = phaseStates(types, stock, now);
  return types.map((t) => {
    const phase = states.get(t.id) ?? null;
    if (!phase || phase.state === "active") return { ...t, phase };
    if (phase.state === "done") return { ...t, phase, salesEndAt: t.salesEndAt && t.salesEndAt < now ? t.salesEndAt : now };
    const opens = phase.startsAt && phase.startsAt > now ? phase.startsAt : NEVER;
    return { ...t, phase, salesStartAt: t.salesStartAt && t.salesStartAt > opens ? t.salesStartAt : opens };
  });
}

/** ¿La fase espera a que se agote la anterior (sin fecha)? Para no mostrar la fecha "nunca". */
export const opensOnSellOut = (phase: PhaseInfo) => phase.state === "upcoming" && phase.startsAt === null;
