/**
 * Retenciones: butacas, mesas o sillas apartadas de la venta en una función (prensa, artistas, producción). En la web
 * aparecen ocupadas; quien tiene el código de la retención las puede comprar. La boletería las vende igual (el cajero
 * las ve marcadas). Liberar = borrar la retención: vuelven a la venta.
 */
import { prisma } from "../client";
import { DomainError, audit, findTakenSeats, type Db } from "./shared";

/** Código de liberación: letras y números, sin espacios, en mayúsculas. */
export function normalizeHoldCode(code: string | null | undefined): string | null {
  const clean = (code ?? "").replace(/\s+/g, "").toUpperCase();
  return clean.length > 0 ? clean.slice(0, 30) : null;
}

/** Butacas retenidas de una función, menos las de la retención cuyo código se escribió. */
export async function getHeldSeatIds(db: Db, sessionId: string, unlockCode?: string | null, onlySeatIds?: string[]): Promise<Set<string>> {
  const code = normalizeHoldCode(unlockCode);
  const held = await db.seatHoldSeat.findMany({
    where: {
      sessionId,
      ...(onlySeatIds ? { seatId: { in: onlySeatIds } } : {}),
      ...(code ? { hold: { OR: [{ code: null }, { code: { not: code } }] } } : {}),
    },
    select: { seatId: true },
  });
  return new Set(held.map((h) => h.seatId));
}

/** La retención de una función que tiene ese código (para la web), o null. */
export async function findHoldByCode(sessionId: string, code: string | null | undefined) {
  const clean = normalizeHoldCode(code);
  if (!clean) return null;
  return prisma.seatHold.findUnique({
    where: { sessionId_code: { sessionId, code: clean } },
    select: { id: true, name: true, _count: { select: { seats: true } } },
  });
}

export async function listSeatHolds(sessionId: string) {
  return prisma.seatHold.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    include: { seats: { select: { seatId: true } }, createdBy: { select: { name: true } } },
  });
}

/** Butacas de la función: deben ser de una sección numerada del recinto de la función. */
async function validSeatIds(db: Db, sessionId: string, seatIds: string[]) {
  const session = await db.eventSession.findUnique({ where: { id: sessionId }, select: { venueId: true } });
  if (!session) throw new DomainError("NOT_FOUND", "Función no encontrada.");
  const seats = await db.seat.findMany({
    where: { id: { in: seatIds }, section: { venueId: session.venueId, seatingMode: "RESERVED" } },
    select: { id: true, label: true },
  });
  if (seats.length !== new Set(seatIds).size) throw new DomainError("INVALID_ITEMS", "Alguna butaca no es de este recinto.");
  return seats;
}

/**
 * Crea una retención o le suma butacas. No se retiene lo vendido (ya tiene dueño) ni lo que está en otra retención.
 */
export async function holdSeats(input: {
  sessionId: string;
  staffId: string;
  seatIds: string[];
  /** Retención existente a la que se suman; si no, se crea una con nombre, color y código. */
  holdId?: string;
  name?: string;
  color?: string;
  code?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (input.seatIds.length === 0) throw new DomainError("INVALID_ITEMS", "Elige al menos una butaca en el mapa.");
  return prisma.$transaction(async (tx) => {
    const seats = await validSeatIds(tx, input.sessionId, input.seatIds);
    const sold = await findTakenSeats(tx, input.sessionId, input.seatIds, now);
    if (sold.length > 0) {
      const labels = seats.filter((s) => sold.includes(s.id)).map((s) => s.label);
      throw new DomainError("SEAT_TAKEN", `Ya están vendidas o reservadas: ${labels.slice(0, 5).join(", ")}${labels.length > 5 ? "…" : ""}.`);
    }
    const other = await tx.seatHoldSeat.findMany({
      where: { sessionId: input.sessionId, seatId: { in: input.seatIds }, ...(input.holdId ? { holdId: { not: input.holdId } } : {}) },
      include: { hold: { select: { name: true } } },
    });
    if (other.length > 0) throw new DomainError("DUPLICATE", `${other.length} butaca(s) ya están en la retención "${other[0]!.hold.name}".`);

    let holdId = input.holdId;
    if (holdId) {
      const hold = await tx.seatHold.findFirst({ where: { id: holdId, sessionId: input.sessionId } });
      if (!hold) throw new DomainError("NOT_FOUND", "Retención no encontrada.");
    } else {
      const name = input.name?.trim() ?? "";
      if (name.length < 2) throw new DomainError("INVALID_ITEMS", "Ponle un nombre a la retención (ej. Prensa).");
      const code = normalizeHoldCode(input.code);
      if (await tx.seatHold.findFirst({ where: { sessionId: input.sessionId, OR: [{ name }, ...(code ? [{ code }] : [])] } })) {
        throw new DomainError("DUPLICATE", "Ya hay una retención con ese nombre o ese código en esta función.");
      }
      const hold = await tx.seatHold.create({
        data: { sessionId: input.sessionId, name: name.slice(0, 40), color: input.color ?? "#7C3AED", code, createdById: input.staffId },
      });
      holdId = hold.id;
    }
    await tx.seatHoldSeat.createMany({
      data: input.seatIds.map((seatId) => ({ holdId: holdId!, seatId, sessionId: input.sessionId })),
      skipDuplicates: true,
    });
    await audit(tx, { actorType: "staff", actorId: input.staffId, action: "hold.seats", entity: "SeatHold", entityId: holdId, data: { added: input.seatIds.length } });
    return holdId!;
  });
}

/** Saca butacas de sus retenciones (vuelven a la venta). */
export async function unholdSeats(input: { sessionId: string; staffId: string; seatIds: string[] }) {
  const { count } = await prisma.seatHoldSeat.deleteMany({ where: { sessionId: input.sessionId, seatId: { in: input.seatIds } } });
  await audit(prisma, { actorType: "staff", actorId: input.staffId, action: "hold.unseat", entity: "EventSession", entityId: input.sessionId, data: { removed: count } });
  return count;
}

/** Cambia nombre, color o código de una retención. */
export async function updateSeatHold(input: { holdId: string; staffId: string; name: string; color: string; code?: string | null }) {
  const hold = await prisma.seatHold.findUnique({ where: { id: input.holdId } });
  if (!hold) throw new DomainError("NOT_FOUND", "Retención no encontrada.");
  const name = input.name.trim();
  if (name.length < 2) throw new DomainError("INVALID_ITEMS", "Ponle un nombre a la retención.");
  const code = normalizeHoldCode(input.code);
  const clash = await prisma.seatHold.findFirst({
    where: { sessionId: hold.sessionId, id: { not: hold.id }, OR: [{ name }, ...(code ? [{ code }] : [])] },
  });
  if (clash) throw new DomainError("DUPLICATE", "Ya hay otra retención con ese nombre o ese código.");
  await prisma.seatHold.update({ where: { id: hold.id }, data: { name: name.slice(0, 40), color: input.color, code } });
  await audit(prisma, { actorType: "staff", actorId: input.staffId, action: "hold.update", entity: "SeatHold", entityId: hold.id });
}

/** Libera una retención: sus butacas vuelven a la venta. */
export async function releaseSeatHold(input: { holdId: string; staffId: string }) {
  const hold = await prisma.seatHold.findUnique({ where: { id: input.holdId }, include: { _count: { select: { seats: true } } } });
  if (!hold) throw new DomainError("NOT_FOUND", "Retención no encontrada.");
  await prisma.seatHold.delete({ where: { id: hold.id } });
  await audit(prisma, {
    actorType: "staff",
    actorId: input.staffId,
    action: "hold.release",
    entity: "SeatHold",
    entityId: hold.id,
    data: { name: hold.name, seats: hold._count.seats },
  });
  return hold._count.seats;
}
