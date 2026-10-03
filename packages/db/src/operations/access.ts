import { parseTicketPayload } from "@ticketera/core";
import { prisma } from "../client";
import type { ScanResult } from "../generated/prisma/client";
import { isUniqueViolation, requireEnv } from "./shared";

export type ScanOutcome = {
  result: ScanResult;
  ticket: {
    code: string;
    holderName: string | null;
    ticketType: string;
    event: string;
    seat: string | null;
    section: string | null;
  } | null;
  /** Para ALREADY_USED: cuándo y por dónde entró antes. */
  previousEntry: { at: Date; accessPoint: string | null } | null;
  /** Para WRONG_GATE: por qué puertas sí puede entrar. */
  allowedGates: string[];
};

/**
 * Valida una entrada en puerta y deja registrada la lectura (aceptada o no).
 *
 * - Marca la entrada como usada con un único UPDATE condicional (status = VALID): si dos
 *   puertas la leen a la vez, solo una la acepta.
 * - Si la puerta tiene secciones asignadas, rechaza entradas de otras secciones.
 * - También recibe lecturas hechas sin conexión (offline = true, con la hora real del
 *   dispositivo). Si al sincronizar la entrada ya había sido usada en otro lado, queda
 *   registrada como ALREADY_USED: es un doble ingreso ocurrido offline, visible en reportes.
 * - Un rechazo decidido sin conexión (offlineResult) solo se registra: la persona no entró,
 *   así que la entrada no se marca como usada aunque al sincronizar resulte válida.
 * - clientScanId hace idempotente el reenvío: si la app sube dos veces la misma lectura
 *   (se cortó la red a mitad de la sincronización), cuenta una sola vez.
 */
export async function scanTicket(input: {
  sessionId: string;
  accessPointId?: string;
  operatorId?: string;
  deviceId?: string;
  raw: string;
  /** Hora de la lectura (para lecturas offline sincronizadas después). */
  scannedAt?: Date;
  offline?: boolean;
  /** Rechazo decidido por el dispositivo sin conexión: se registra tal cual. */
  offlineResult?: Exclude<ScanResult, "ACCEPTED">;
  clientScanId?: string;
}): Promise<ScanOutcome> {
  if (input.clientScanId) {
    const done = await prisma.accessScan.findUnique({ where: { clientScanId: input.clientScanId } });
    if (done) return replayOutcome(done);
  }
  const scannedAt = input.scannedAt ?? new Date();
  const parsed = await parseTicketPayload(input.raw, requireEnv("TICKET_QR_SECRET"));

  let result: ScanResult = "INVALID";
  let allowedGates: string[] = [];
  const ticket = parsed.ok
    ? await prisma.ticket.findUnique({
        where: { code: parsed.code },
        include: { ticketType: true, seat: { include: { section: true } }, session: { include: { event: true } } },
      })
    : null;

  if (input.offlineResult) result = input.offlineResult;
  else if (parsed.ok) {
    if (!ticket) result = "NOT_FOUND";
    else if (ticket.sessionId !== input.sessionId) result = "WRONG_SESSION";
    else {
      const gate = input.accessPointId
        ? await prisma.accessPoint.findUnique({
            where: { id: input.accessPointId },
            include: { sections: { select: { id: true } } },
          })
        : null;
      const restricted = gate && gate.sections.length > 0;
      if (restricted && !gate.sections.some((s) => s.id === ticket.ticketType.sectionId)) {
        result = "WRONG_GATE";
        allowedGates = ticket.ticketType.sectionId
          ? (
              await prisma.accessPoint.findMany({
                where: { venueId: gate.venueId, sections: { some: { id: ticket.ticketType.sectionId } } },
                select: { name: true },
              })
            ).map((g) => g.name)
          : [];
      } else {
        const { count } = await prisma.ticket.updateMany({
          where: { id: ticket.id, status: "VALID" },
          data: { status: "USED", usedAt: scannedAt },
        });
        if (count === 1) result = "ACCEPTED";
        else {
          const current = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: { status: true } });
          result = current.status === "CANCELLED" ? "CANCELLED" : "ALREADY_USED";
        }
      }
    }
  }

  const previous =
    result === "ALREADY_USED" && ticket
      ? await prisma.accessScan.findFirst({
          where: { ticketId: ticket.id, result: "ACCEPTED" },
          orderBy: { scannedAt: "asc" },
          include: { accessPoint: true },
        })
      : null;

  try {
    await prisma.accessScan.create({
      data: {
        sessionId: input.sessionId,
        ticketId: ticket?.id,
        accessPointId: input.accessPointId,
        operatorId: input.operatorId,
        deviceId: input.deviceId?.slice(0, 64),
        result,
        rawCode: input.raw.slice(0, 200),
        scannedAt,
        offline: Boolean(input.offline),
        syncedAt: input.offline ? new Date() : null,
        clientScanId: input.clientScanId,
      },
    });
  } catch (error) {
    // El mismo reenvío llegó dos veces a la vez: vale la lectura que se guardó primero.
    if (input.clientScanId && isUniqueViolation(error)) {
      return replayOutcome(await prisma.accessScan.findUniqueOrThrow({ where: { clientScanId: input.clientScanId } }));
    }
    throw error;
  }

  return {
    result,
    ticket: ticket
      ? {
          code: ticket.code,
          holderName: ticket.holderName,
          ticketType: ticket.ticketType.name,
          event: ticket.session.event.title,
          seat: ticket.seat?.label ?? null,
          section: ticket.seat?.section.name ?? null,
        }
      : null,
    previousEntry: previous ? { at: previous.scannedAt, accessPoint: previous.accessPoint?.name ?? null } : null,
    allowedGates,
  };
}

/** Resultado de una lectura ya registrada (reenvío de la app de puerta). */
async function replayOutcome(scan: { result: ScanResult; ticketId: string | null }): Promise<ScanOutcome> {
  const ticket = scan.ticketId
    ? await prisma.ticket.findUnique({
        where: { id: scan.ticketId },
        include: { ticketType: true, seat: { include: { section: true } }, session: { include: { event: true } } },
      })
    : null;
  return {
    result: scan.result,
    ticket: ticket
      ? {
          code: ticket.code,
          holderName: ticket.holderName,
          ticketType: ticket.ticketType.name,
          event: ticket.session.event.title,
          seat: ticket.seat?.label ?? null,
          section: ticket.seat?.section.name ?? null,
        }
      : null,
    previousEntry: null,
    allowedGates: [],
  };
}

/**
 * Lo que descarga la app de puerta antes de abrir: todas las entradas de la función y las
 * puertas con sus secciones. Con esto puede seguir validando si se cae internet.
 * No incluye el secreto del QR: offline se valida que el código exista en la lista
 * (los códigos son aleatorios e imposibles de adivinar).
 */
export async function getSessionSyncData(sessionId: string) {
  const session = await prisma.eventSession.findUnique({
    where: { id: sessionId },
    include: {
      event: { select: { title: true } },
      venue: {
        select: {
          name: true,
          timezone: true,
          accessPoints: { orderBy: { name: "asc" }, include: { sections: { select: { id: true, name: true } } } },
          sections: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!session) return null;
  const tickets = await prisma.ticket.findMany({
    where: { sessionId },
    select: {
      code: true,
      status: true,
      holderName: true,
      ticketType: { select: { name: true, sectionId: true } },
      seat: { select: { label: true } },
      order: { select: { buyerName: true } },
    },
  });
  return {
    syncedAt: new Date().toISOString(),
    session: {
      id: session.id,
      title: session.event.title,
      startsAt: session.startsAt.toISOString(),
      venue: session.venue.name,
      timezone: session.venue.timezone,
    },
    gates: session.venue.accessPoints.map((g) => ({
      id: g.id,
      name: g.name,
      sectionIds: g.sections.map((s) => s.id),
      sections: g.sections.map((s) => s.name),
    })),
    sections: Object.fromEntries(session.venue.sections.map((s) => [s.id, s.name])),
    tickets: tickets.map((t) => ({
      code: t.code,
      status: t.status,
      holder: t.holderName ?? t.order.buyerName,
      type: t.ticketType.name,
      sectionId: t.ticketType.sectionId,
      seat: t.seat?.label ?? null,
    })),
  };
}

export type SessionSyncData = NonNullable<Awaited<ReturnType<typeof getSessionSyncData>>>;

export async function getAccessStats(sessionId: string) {
  const [issued, used, recent] = await Promise.all([
    prisma.ticket.count({ where: { sessionId, status: { in: ["VALID", "USED"] } } }),
    prisma.ticket.count({ where: { sessionId, status: "USED" } }),
    prisma.accessScan.findMany({
      where: { sessionId },
      orderBy: { scannedAt: "desc" },
      take: 15,
      include: { accessPoint: true, ticket: { include: { ticketType: true } } },
    }),
  ]);
  return { issued, used, recent };
}
