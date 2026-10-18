/**
 * Estado de cada mesa en una función, para los anfitriones: libre, vendida (todavía no llegó nadie) u ocupada (ya
 * entró alguien), con cuántas personas entraron, quién la compró y el consumo que le queda. Cubre lounges del plano,
 * mesas con sillas y mesas de una zona sin mapa.
 */
import { isSeatedTablesLayout, isTablesLayout } from "@ticketera/core";
import { prisma } from "../client";

export type TableLiveStatus = "FREE" | "SOLD" | "OCCUPIED";

export type TableLive = {
  key: string;
  name: string;
  status: TableLiveStatus;
  /** Entradas de la mesa (personas o sillas vendidas). */
  people: number;
  /** Cuántas ya entraron y cuántas están adentro ahora. */
  entered: number;
  inside: number;
  /** En mesas con sillas: sillas vendidas de las que tiene. */
  chairs?: { sold: number; total: number };
  buyer: string | null;
  consumption: { left: number; currency: string } | null;
  /** Libre pero apartada en una retención (prensa, artistas…): el nombre de la retención. */
  held?: string | null;
};

export type TableGroupLive = { key: string; name: string; color: string; tables: TableLive[]; freeCount: number };

const activeOrder = (now: Date) => ({ OR: [{ status: { in: ["PAID" as const, "PARTIALLY_REFUNDED" as const] } }, { status: "PENDING_PAYMENT" as const, expiresAt: { gt: now } }] });

function statusOf(people: number, entered: number): TableLiveStatus {
  return people === 0 ? "FREE" : entered > 0 ? "OCCUPIED" : "SOLD";
}

export async function getTableStates(sessionId: string, now = new Date()): Promise<TableGroupLive[]> {
  const session = await prisma.eventSession.findUnique({
    where: { id: sessionId },
    select: {
      venueId: true,
      ticketTypes: { where: { kind: "TABLE" }, select: { id: true, name: true, capacity: true, section: { select: { seatingMode: true, color: true } } } },
    },
  });
  if (!session) return [];
  const sections = (
    await prisma.section.findMany({
      where: { venueId: session.venueId, seatingMode: "RESERVED" },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, color: true, layout: true, seats: { select: { id: true, label: true, row: true, number: true } } },
    })
  ).filter((s) => isTablesLayout(s.layout) || isSeatedTablesLayout(s.layout));
  const seatIds = sections.flatMap((s) => s.seats.map((seat) => seat.id));
  const gaTables = session.ticketTypes.filter((t) => t.section?.seatingMode !== "RESERVED");

  const [items, tickets, holds] = await Promise.all([
    seatIds.length
      ? prisma.orderItem.findMany({
          where: { seatId: { in: seatIds }, ticketType: { sessionId }, order: activeOrder(now) },
          select: { seatId: true, order: { select: { buyerName: true } } },
        })
      : [],
    prisma.ticket.findMany({
      where: {
        sessionId,
        status: { in: ["VALID", "USED"] },
        OR: [
          ...(seatIds.length ? [{ seatId: { in: seatIds } }, { credit: { seatId: { in: seatIds } } }] : []),
          ...(gaTables.length ? [{ ticketTypeId: { in: gaTables.map((t) => t.id) } }] : []),
        ],
      },
      select: {
        status: true,
        inside: true,
        seatId: true,
        ticketTypeId: true,
        order: { select: { buyerName: true } },
        credit: { select: { id: true, seatId: true, tableNumber: true, amount: true, spent: true, currency: true } },
      },
    }),
    seatIds.length ? prisma.seatHoldSeat.findMany({ where: { sessionId, seatId: { in: seatIds } }, select: { seatId: true, hold: { select: { name: true } } } }) : [],
  ]);
  const heldBy = new Map(holds.map((h) => [h.seatId, h.hold.name]));
  const buyerOf = new Map(items.map((i) => [i.seatId!, i.order.buyerName]));
  const summarize = (list: typeof tickets) => ({
    people: list.length,
    entered: list.filter((t) => t.status === "USED").length,
    inside: list.filter((t) => t.inside).length,
    consumption: list[0]?.credit && list[0].credit.amount > 0 ? { left: list[0].credit.amount - list[0].credit.spent, currency: list[0].credit.currency } : null,
  });

  const groups: TableGroupLive[] = [];
  for (const section of sections) {
    if (isTablesLayout(section.layout)) {
      const tables = section.seats
        .toSorted((a, b) => Number(a.number) - Number(b.number))
        .map((seat): TableLive => {
          const own = tickets.filter((t) => t.credit?.seatId === seat.id || t.seatId === seat.id);
          const sum = summarize(own);
          const sold = buyerOf.has(seat.id) || own.length > 0;
          return {
            key: seat.id,
            name: seat.label,
            ...sum,
            status: sold ? statusOf(Math.max(sum.people, 1), sum.entered) : "FREE",
            buyer: buyerOf.get(seat.id) ?? own[0]?.order.buyerName ?? null,
            held: sold ? null : (heldBy.get(seat.id) ?? null),
          };
        });
      groups.push({ key: section.id, name: section.name, color: section.color, tables, freeCount: tables.filter((t) => t.status === "FREE").length });
    } else if (isSeatedTablesLayout(section.layout)) {
      const prefix = section.layout.prefix;
      const rows = new Map<string, typeof section.seats>();
      for (const seat of section.seats) rows.set(seat.row, [...(rows.get(seat.row) ?? []), seat]);
      const tables = [...rows.entries()]
        .toSorted((a, b) => Number(a[0]) - Number(b[0]))
        .map(([row, chairs]): TableLive => {
          const ids = new Set(chairs.map((c) => c.id));
          const own = tickets.filter((t) => t.seatId && ids.has(t.seatId));
          const soldChairs = chairs.filter((c) => buyerOf.has(c.id)).length;
          const sum = summarize(own);
          return {
            key: `${section.id}:${row}`,
            name: `${prefix} ${row}`,
            ...sum,
            status: statusOf(soldChairs, sum.entered),
            chairs: { sold: soldChairs, total: chairs.length },
            buyer: [...new Set(chairs.flatMap((c) => (buyerOf.get(c.id) ? [buyerOf.get(c.id)!] : [])))].join(", ") || null,
            held: chairs.map((c) => heldBy.get(c.id)).find(Boolean) ?? null,
          };
        });
      groups.push({ key: section.id, name: section.name, color: section.color, tables, freeCount: tables.filter((t) => t.status === "FREE").length });
    }
  }
  // Mesas de una zona sin mapa: cada una es una mesa numerada al venderse; las libres se cuentan.
  for (const type of gaTables) {
    const byCredit = new Map<string, typeof tickets>();
    for (const t of tickets.filter((x) => x.ticketTypeId === type.id && x.credit?.tableNumber != null)) {
      byCredit.set(t.credit!.id, [...(byCredit.get(t.credit!.id) ?? []), t]);
    }
    const tables = [...byCredit.values()]
      .toSorted((a, b) => a[0]!.credit!.tableNumber! - b[0]!.credit!.tableNumber!)
      .map((own): TableLive => {
        const sum = summarize(own);
        return { key: own[0]!.credit!.id, name: `${type.name} ${own[0]!.credit!.tableNumber}`, ...sum, status: statusOf(sum.people, sum.entered), buyer: own[0]!.order.buyerName };
      });
    groups.push({ key: type.id, name: type.name, color: type.section?.color ?? "#C04BFF", tables, freeCount: Math.max(0, type.capacity - tables.length) });
  }
  return groups;
}
