import { isTablesLayout, mapItemsOf } from "@ticketera/core";
import { prisma } from "../client";

export type LiveScan = { at: string; result: string; gate: string | null; operator: string | null; device: string | null; method: string | null };

export type LiveTicket = {
  id: string;
  code: string;
  status: "VALID" | "USED" | "CANCELLED";
  sectionId: string | null;
  type: string;
  seatId: string | null;
  seatLabel: string | null;
  holder: string;
  document: string | null;
  /** Cuándo y por dónde entró (la lectura aceptada). */
  entry: LiveScan | null;
  /** Intentos rechazados con esta entrada (reingresos, puerta equivocada, anulada…). */
  attempts: LiveScan[];
};

export type LiveSection = {
  id: string;
  name: string;
  color: string;
  seatingMode: "GENERAL_ADMISSION" | "RESERVED";
  /** Butacas con posición en el plano (solo secciones numeradas). `short`: número de un lounge en círculo. */
  seats: { id: string; x: number; y: number; label: string; short: string }[];
  /** Lounges en círculo: cada "butaca" es una mesa. */
  table: { radius: number } | null;
  issued: number;
  entered: number;
};

export type LiveAccess = Awaited<ReturnType<typeof getLiveAccess>>;

/**
 * Estado de ingreso de una función en vivo: por sección, el mapa de butacas o la lista de entradas
 * con quién ya entró, a qué hora y por qué puerta, más cada intento rechazado.
 */
export async function getLiveAccess(sessionId: string) {
  const session = await prisma.eventSession.findUnique({
    where: { id: sessionId },
    include: {
      event: { select: { title: true } },
      venue: {
        select: {
          name: true,
          timezone: true,
          mapItems: true,
          accessPoints: { orderBy: { name: "asc" }, select: { id: true, name: true } },
          sections: { orderBy: { sortOrder: "asc" }, include: { seats: { select: { id: true, x: true, y: true, label: true, number: true } } } },
        },
      },
    },
  });
  if (!session) return null;

  const [tickets, scans] = await Promise.all([
    prisma.ticket.findMany({
      where: { sessionId },
      orderBy: [{ issuedAt: "asc" }],
      select: {
        id: true,
        code: true,
        status: true,
        holderName: true,
        holderDocument: true,
        seatId: true,
        seat: { select: { label: true, sectionId: true } },
        // Lounge en círculo: todas sus personas se pintan sobre la mesa.
        credit: { select: { seatId: true } },
        ticketType: { select: { name: true, sectionId: true } },
        order: { select: { buyerName: true, buyerDocument: true } },
      },
    }),
    prisma.accessScan.findMany({
      where: { sessionId },
      orderBy: { scannedAt: "asc" },
      select: {
        ticketId: true,
        result: true,
        scannedAt: true,
        method: true,
        deviceId: true,
        rawCode: true,
        accessPoint: { select: { name: true } },
        operator: { select: { name: true } },
      },
    }),
  ]);

  const toScan = (s: (typeof scans)[number]): LiveScan => ({
    at: s.scannedAt.toISOString(),
    result: s.result,
    gate: s.accessPoint?.name ?? null,
    operator: s.operator?.name ?? null,
    device: s.deviceId,
    method: s.method,
  });

  const entryByTicket = new Map<string, LiveScan>();
  const attemptsByTicket = new Map<string, LiveScan[]>();
  for (const s of scans) {
    if (!s.ticketId) continue;
    if (s.result === "ACCEPTED") {
      if (!entryByTicket.has(s.ticketId)) entryByTicket.set(s.ticketId, toScan(s));
    } else {
      attemptsByTicket.set(s.ticketId, [...(attemptsByTicket.get(s.ticketId) ?? []), toScan(s)]);
    }
  }

  const liveTickets: LiveTicket[] = tickets.map((t) => ({
    id: t.id,
    code: t.code,
    status: t.status,
    sectionId: t.seat?.sectionId ?? t.ticketType.sectionId,
    type: t.ticketType.name,
    seatId: t.seatId ?? t.credit?.seatId ?? null,
    seatLabel: t.seat?.label ?? null,
    holder: t.holderName ?? t.order.buyerName,
    document: t.holderDocument ?? t.order.buyerDocument,
    entry: entryByTicket.get(t.id) ?? null,
    attempts: attemptsByTicket.get(t.id) ?? [],
  }));

  const active = liveTickets.filter((t) => t.status !== "CANCELLED");
  const sections: LiveSection[] = session.venue.sections.map((s) => {
    const own = active.filter((t) => t.sectionId === s.id);
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      seatingMode: s.seatingMode,
      seats:
        s.seatingMode === "RESERVED"
          ? s.seats.flatMap((seat) => (seat.x !== null && seat.y !== null ? [{ id: seat.id, x: seat.x, y: seat.y, label: seat.label, short: seat.number }] : []))
          : [],
      table: isTablesLayout(s.layout) ? { radius: s.layout.radius } : null,
      issued: own.length,
      entered: own.filter((t) => t.status === "USED").length,
    };
  });

  // Entradas de un tipo sin sección (no debería pasar) igual cuentan en el total.
  const byGate = session.venue.accessPoints.map((g) => ({
    id: g.id,
    name: g.name,
    entered: scans.filter((s) => s.result === "ACCEPTED" && s.accessPoint?.name === g.name).length,
  }));

  const rejected = scans
    .filter((s) => s.result !== "ACCEPTED")
    .map((s) => {
      const ticket = s.ticketId ? liveTickets.find((t) => t.id === s.ticketId) : undefined;
      return {
        ...toScan(s),
        ticketId: s.ticketId,
        code: ticket?.code ?? s.rawCode.slice(0, 40),
        holder: ticket?.holder ?? null,
      };
    })
    .reverse();

  return {
    syncedAt: new Date().toISOString(),
    session: {
      id: session.id,
      title: session.event.title,
      startsAt: session.startsAt.toISOString(),
      venue: session.venue.name,
      timezone: session.venue.timezone,
    },
    totals: {
      issued: active.length,
      entered: active.filter((t) => t.status === "USED").length,
      rejected: rejected.length,
      /** QR dinámico vencido: intentos con una captura (o un reloj muy desajustado). */
      qrExpired: rejected.filter((r) => r.result === "QR_EXPIRED").length,
    },
    gates: byGate,
    sections,
    /** Plano del boliche (escenario, barras…). */
    mapItems: mapItemsOf(session.venue.mapItems),
    tickets: liveTickets,
    rejected: rejected.slice(0, 100),
  };
}
