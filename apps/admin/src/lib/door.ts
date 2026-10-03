import { prisma } from "@ticketera/db";
import type { Staff } from "./session";

/** Funciones que se controlan en puerta: de la organización, no canceladas. */
export function doorSession(staff: Staff, sessionId: string) {
  return prisma.eventSession.findFirst({
    where: {
      id: sessionId,
      cancelledAt: null,
      event: { organizationId: staff.organization.id, status: { not: "CANCELLED" } },
    },
    include: { event: { select: { title: true, mode: true } }, venue: { select: { name: true, timezone: true } } },
  });
}

/** Funciones de las últimas 24 h en adelante (las que un operador puede tener que controlar). */
export function upcomingDoorSessions(staff: Staff) {
  return prisma.eventSession.findMany({
    where: {
      cancelledAt: null,
      startsAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
      event: { organizationId: staff.organization.id, status: { not: "CANCELLED" } },
    },
    orderBy: { startsAt: "asc" },
    take: 50,
    include: {
      event: { select: { title: true, mode: true } },
      venue: { select: { name: true, timezone: true } },
      _count: { select: { tickets: { where: { status: { in: ["VALID", "USED"] } } } } },
    },
  });
}
