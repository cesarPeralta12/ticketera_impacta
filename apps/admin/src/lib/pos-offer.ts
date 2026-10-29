import { MAX_TICKETS_PER_ORDER, currentPrice, discountLabel, formatDateTime, isSeatedTablesLayout, isTablesLayout, saleState, withPhases } from "@ticketera/core";
import { getSessionStock, getTakenSeatIds, listSeatHolds, type Prisma } from "@ticketera/db";
import type { PosGeneralType, PosSeatedType } from "@/app/(panel)/boleteria/[sessionId]/pos-form";

/** Lo que hace falta de una función para vender en caja o como promotor. */
export const POS_SESSION_INCLUDE = {
  event: true,
  venue: true,
  ticketTypes: {
    orderBy: { sortOrder: "asc" },
    include: { section: { include: { seats: { orderBy: [{ row: "asc" }, { number: "asc" }] } } } },
  },
} satisfies Prisma.EventSessionInclude;

export type PosSession = Prisma.EventSessionGetPayload<{ include: typeof POS_SESSION_INCLUDE }>;

/**
 * Lo que se puede vender ahora de una función: lo mismo que online en este momento (la preventa mientras dure, la
 * general cuando empiece; con fases, solo la que se vende ahora). Los tipos de QR dinámico son solo online.
 *
 * La boletería vende también las butacas retenidas (las ve con el color de su retención); un promotor no: para él
 * están ocupadas, como en la web.
 */
export async function posOffer(session: PosSession, options: { promoter?: boolean } = {}) {
  const [stock, sold, holds] = await Promise.all([getSessionStock(session.id), getTakenSeatIds(session.id), listSeatHolds(session.id)]);
  const remaining = stock.remaining;
  const heldBy = new Map(holds.flatMap((h) => h.seats.map((seat) => [seat.seatId, { name: h.name, color: h.color }] as const)));
  const taken = new Set([...sold, ...(options.promoter ? heldBy.keys() : [])]);

  const openTypes = withPhases(session.ticketTypes, stock).filter((t) => saleState(t) === "open" && t.qrMode === "STATIC");
  const now = new Date();
  const general: PosGeneralType[] = openTypes
    .filter((t) => t.section?.seatingMode !== "RESERVED")
    .map((t) => ({
      id: t.id,
      name: t.phase
        ? `${t.name} (fase ${t.phase.position} de ${t.phase.total})`
        : t.presale && t.salesEndAt
          ? `${t.name} (preventa hasta ${formatDateTime(t.salesEndAt, session.venue.timezone)})`
          : t.name,
      detail: t.section ? `${t.section.name} · quedan ${remaining.get(t.id) ?? 0}` : `quedan ${remaining.get(t.id) ?? 0}`,
      unitAmount: currentPrice(t, now).unitAmount,
      listAmount: currentPrice(t, now).discountPercent ? t.unitAmount : null,
      discountLabel: discountLabel(t, now, session.venue.timezone),
      currency: t.currency,
      max: Math.min(remaining.get(t.id) ?? 0, t.maxPerOrder, MAX_TICKETS_PER_ORDER),
    }));

  const seated: PosSeatedType[] = openTypes
    .filter((t) => t.section?.seatingMode === "RESERVED")
    .map((t) => ({
      ticketTypeId: t.id,
      name: t.section!.name,
      color: t.section!.color,
      unitAmount: currentPrice(t, now).unitAmount,
      discountPercent: currentPrice(t, now).discountPercent,
      currency: t.currency,
      presale: t.presale,
      maxPerOrder: Math.min(t.maxPerOrder, MAX_TICKETS_PER_ORDER),
      table: isTablesLayout(t.section!.layout) ? { radius: t.section!.layout.radius, shape: t.section!.layout.shape } : null,
      wholeTable:
        isSeatedTablesLayout(t.section!.layout) && t.section!.layout.mode === "WHOLE"
          ? { prefix: t.section!.layout.prefix, chairs: t.section!.layout.chairs }
          : null,
      seats: t.section!.seats
        .toSorted((a, b) => a.row.localeCompare(b.row) || Number(a.number) - Number(b.number) || a.number.localeCompare(b.number))
        .flatMap((s) =>
          s.x !== null && s.y !== null
            ? [{ id: s.id, label: s.label, x: s.x, y: s.y, taken: taken.has(s.id), short: s.number, group: s.row, held: options.promoter ? null : (heldBy.get(s.id) ?? null) }]
            : [],
        ),
    }))
    .filter((t) => t.seats.length > 0);

  return { general, seated };
}
