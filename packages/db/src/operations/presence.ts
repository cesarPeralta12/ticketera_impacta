/**
 * Presencia en el recinto: quién está adentro y en qué zona, el aforo en vivo por zona, el historial de cada entrada
 * y la corrección manual (un administrador marca afuera, adentro o "no ingresó" cuando la puerta se equivocó).
 */
import { prisma } from "../client";
import { DomainError, audit } from "./shared";

/** Aforo en vivo de una función: personas adentro por zona (con su tope) y totales de ingresos y salidas. */
export async function getZoneOccupancy(sessionId: string) {
  const session = await prisma.eventSession.findUnique({
    where: { id: sessionId },
    select: { venue: { select: { zones: { orderBy: [{ level: "asc" }, { name: "asc" }] } } } },
  });
  if (!session) return null;
  const [byZone, entered, exited, reentries] = await Promise.all([
    prisma.ticket.groupBy({ by: ["zoneId"], where: { sessionId, inside: true, status: "USED" }, _count: true }),
    prisma.ticket.count({ where: { sessionId, status: "USED" } }),
    prisma.ticket.count({ where: { sessionId, status: "USED", inside: false } }),
    prisma.accessScan.count({ where: { sessionId, movement: "REENTRY" } }),
  ]);
  const count = (zoneId: string | null) => byZone.find((z) => z.zoneId === zoneId)?._count ?? 0;
  const zones = session.venue.zones.map((z) => ({
    id: z.id,
    name: z.name,
    color: z.color,
    level: z.level,
    capacity: z.capacity,
    inside: count(z.id),
  }));
  const inside = byZone.reduce((sum, z) => sum + z._count, 0);
  return {
    zones,
    /** Adentro sin zona (entraron por una puerta general). */
    general: count(null),
    inside,
    entered,
    exited,
    reentries,
  };
}

/** Cada lectura de una entrada (aceptada o no), de la más nueva a la más vieja, con puerta, zona y quién la hizo. */
export async function getTicketAccessHistory(ticketId: string) {
  return prisma.accessScan.findMany({
    where: { ticketId },
    orderBy: { scannedAt: "desc" },
    take: 100,
    select: {
      id: true,
      result: true,
      movement: true,
      scannedAt: true,
      offline: true,
      method: true,
      rawCode: true,
      accessPoint: { select: { name: true, direction: true } },
      zone: { select: { name: true } },
      operator: { select: { name: true } },
    },
  });
}

export type PresenceCorrection = "OUT" | "IN" | "RESET";

/**
 * Corrección manual de presencia (la puerta se equivocó o se cortó la luz):
 *  - OUT: la persona salió (queda afuera; puede reingresar si su tipo lo permite).
 *  - IN: la persona está adentro (en la zona elegida); si nunca había entrado, cuenta como su ingreso.
 *  - RESET: "no ingresó": la lectura fue un error; la entrada vuelve a estar sin usar.
 * Queda como lectura MANUAL en el historial y en Seguridad.
 */
export async function correctPresence(input: { ticketId: string; staffId: string; action: PresenceCorrection; zoneId?: string | null; reason: string; now?: Date }) {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DomainError("INVALID_STATE", "Escribe el motivo de la corrección.");
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id: input.ticketId },
      include: { session: { select: { id: true, venueId: true } } },
    });
    if (!ticket) throw new DomainError("NOT_FOUND", "Entrada no encontrada.");
    if (ticket.status === "CANCELLED") throw new DomainError("INVALID_STATE", "La entrada está anulada.");
    let zoneId: string | null = null;
    if (input.action === "IN" && input.zoneId) {
      const zone = await tx.accessZone.findFirst({ where: { id: input.zoneId, venueId: ticket.session.venueId } });
      if (!zone) throw new DomainError("NOT_FOUND", "Zona no encontrada en este recinto.");
      zoneId = zone.id;
    }
    if (input.action === "OUT" && !ticket.inside) throw new DomainError("INVALID_STATE", "La entrada ya figura afuera.");
    if (input.action === "RESET" && ticket.status !== "USED") throw new DomainError("INVALID_STATE", "La entrada todavía no se usó.");

    const data =
      input.action === "OUT"
        ? { inside: false, zoneId: null, lastMovementAt: now }
        : input.action === "IN"
          ? {
              inside: true,
              zoneId,
              lastMovementAt: now,
              ...(ticket.status === "VALID" ? { status: "USED" as const, usedAt: now, entries: 1 } : {}),
            }
          : { status: "VALID" as const, usedAt: null, inside: false, zoneId: null, entries: 0, lastMovementAt: now };
    await tx.ticket.update({ where: { id: ticket.id }, data });
    await tx.accessScan.create({
      data: {
        sessionId: ticket.session.id,
        ticketId: ticket.id,
        operatorId: input.staffId,
        result: "ACCEPTED",
        movement: "MANUAL",
        zoneId,
        method: "MANUAL",
        rawCode: `Corrección (${input.action === "OUT" ? "afuera" : input.action === "IN" ? "adentro" : "no ingresó"}): ${reason}`.slice(0, 200),
        scannedAt: now,
      },
    });
    await audit(tx, {
      actorType: "staff",
      actorId: input.staffId,
      action: "presence.correct",
      entity: "Ticket",
      entityId: ticket.id,
      data: { action: input.action, zoneId, reason },
      severity: "warn",
    });
  });
}

/**
 * Lecturas sin conexión que al sincronizar chocaron con lo que ya había pasado (la entrada ya había entrado por
 * otra puerta, estaba anulada o no existía): para revisar después del evento.
 */
export async function getOfflineConflicts(sessionId: string) {
  return prisma.accessScan.findMany({
    where: { sessionId, offline: true, result: { in: ["ALREADY_USED", "CANCELLED", "NOT_FOUND", "INVALID", "NOT_ACTIVATED"] } },
    orderBy: { scannedAt: "desc" },
    take: 100,
    select: {
      id: true,
      result: true,
      scannedAt: true,
      syncedAt: true,
      rawCode: true,
      deviceId: true,
      accessPoint: { select: { name: true } },
      operator: { select: { name: true } },
      ticket: { select: { code: true, holderName: true } },
    },
  });
}
