import {
  deriveTicketKey,
  parseDynamicPayload,
  parseManualWithOtp,
  parseTicketPayload,
  printedOpensDoor,
  tableLabel,
  type PrintStateName,
  verifyDynamicOtp,
  verifyDynamicPayload,
} from "@ticketera/core";
import { prisma } from "../client";
import type { AccessMethod, PresenceMovement, ScanResult } from "../generated/prisma/client";
import { expireTimedTickets } from "./nightlife";
import { isUniqueViolation, requireEnv } from "./shared";

/** Métodos de lectura que reporta la app; MANUAL (código escrito) siempre se admite. */
export type ScanMethod = AccessMethod | "MANUAL";

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
  /** Lectura aceptada: primer ingreso, reingreso, salida o cambio de zona; y la zona en la que quedó. */
  movement?: Exclude<PresenceMovement, "MANUAL">;
  zone?: string | null;
  /**
   * Solo QR dinámico leído sin conexión, al sincronizar: BAD_PROOF = la prueba no corresponde a la entrada
   * (teléfono modificado o QR falsificado); STALE_OFFLINE = auténtica pero de un momento lejano a la lectura.
   */
  proofNote?: "BAD_PROOF" | "STALE_OFFLINE";
};

/** Pasos que se toleran al revisar una lectura hecha sin conexión: el reloj del teléfono pudo desajustarse. */
const OFFLINE_STEP_WINDOW = 2;

/**
 * Valida una entrada en puerta y deja registrada la lectura (aceptada o no).
 *
 * - Marca la entrada como usada con un único UPDATE condicional (status = VALID): si dos
 *   puertas la leen a la vez, solo una la acepta.
 * - Si la puerta tiene secciones asignadas, rechaza entradas de otras secciones; si da a una zona (VIP), solo
 *   entran los tipos de entrada que abren esa zona.
 * - Presencia: una puerta de salida (o de ida y vuelta con la entrada adentro) registra la salida; con reingreso
 *   permitido, la entrada vuelve a pasar mientras no supere sus ingresos; ya adentro, una puerta a otra zona es un
 *   cambio de zona. Sin reingreso (lo de siempre), una segunda lectura es "ya utilizada".
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
  /** Cómo se leyó la entrada. Si el tipo de entrada no admite ese método, se rechaza. */
  method?: ScanMethod;
}): Promise<ScanOutcome> {
  if (input.clientScanId) {
    const done = await prisma.accessScan.findUnique({ where: { clientScanId: input.clientScanId } });
    if (done) return replayOutcome(done);
  }
  const scannedAt = input.scannedAt ?? new Date();
  await expireTimedTickets(input.sessionId);
  const secret = requireEnv("TICKET_QR_SECRET");
  const raw = input.raw.trim();
  // Tres formas de leer una entrada: QR dinámico (TK2), código + OTP escrito a mano, o código estático (TK1 / solo código).
  const dynamic = raw.startsWith("TK2.") ? parseDynamicPayload(raw) : null;
  const otp = dynamic ? null : parseManualWithOtp(raw);
  const statik = dynamic || otp ? null : await parseTicketPayload(raw, secret);
  const code = dynamic?.code ?? otp?.code ?? (statik?.ok ? statik.code : null);

  let result: ScanResult = "INVALID";
  let allowedGates: string[] = [];
  let movement: ScanOutcome["movement"];
  let zoneAfter: { id: string; name: string } | null = null;
  let proofNote: ScanOutcome["proofNote"];
  const ticket = code
    ? await prisma.ticket.findUnique({
        where: { code },
        include: {
          ticketType: { include: { zones: { select: { id: true } } } },
          seat: { include: { section: true } },
          session: { include: { event: true } },
          credit: { select: { tableNumber: true, seat: { select: { label: true } } } },
          printBatch: { select: { mode: true } },
        },
      })
    : null;

  // Tipo de QR: una entrada dinámica solo se acepta con una prueba vigente (QR o código + OTP); su código estático no sirve.
  let qrFailure: ScanResult | null = null;
  if (ticket && !input.offlineResult) {
    const isDynamicType = ticket.ticketType.qrMode === "DYNAMIC";
    const at = (input.offline ? scannedAt : new Date()).getTime();
    const window = input.offline ? OFFLINE_STEP_WINDOW : undefined;
    if (dynamic) {
      if (!isDynamicType) qrFailure = "INVALID"; // un TK2 solo existe para entradas dinámicas
      else {
        const verdict = await verifyDynamicPayload(await deriveTicketKey(secret, ticket.code), dynamic, at, window);
        if (verdict === "INVALID") {
          qrFailure = "INVALID";
          if (input.offline) proofNote = "BAD_PROOF";
        } else if (verdict === "EXPIRED") {
          // En vivo es una captura vieja. Sin conexión ya entró: se acepta y se deja anotado.
          if (input.offline) proofNote = "STALE_OFFLINE";
          else qrFailure = "QR_EXPIRED";
        }
      }
    } else if (otp) {
      if (isDynamicType && !(await verifyDynamicOtp(await deriveTicketKey(secret, ticket.code), ticket.code, otp.otp, at, window))) {
        qrFailure = "INVALID";
        if (input.offline) proofNote = "BAD_PROOF";
      }
    } else if (isDynamicType) {
      qrFailure = "STATIC_NOT_ALLOWED";
    }
  }

  if (input.offlineResult) result = input.offlineResult;
  else if (code) {
    if (!ticket) result = "NOT_FOUND";
    else if (ticket.sessionId !== input.sessionId) result = "WRONG_SESSION";
    else if (qrFailure) result = qrFailure;
    else if (input.method && input.method !== "MANUAL" && !ticket.ticketType.accessMethods.includes(input.method)) {
      result = "METHOD_NOT_ALLOWED";
    } else if (
      // Entrada impresa sin vender (lote "activada al vender"): una fotocopia o una robada no pasa.
      ticket.printBatch &&
      ticket.printState !== "VOID" &&
      !printedOpensDoor(ticket.printBatch.mode, (ticket.printState ?? "STOCK") as PrintStateName)
    ) {
      result = "NOT_ACTIVATED";
    } else {
      const gate = input.accessPointId
        ? await prisma.accessPoint.findUnique({
            where: { id: input.accessPointId },
            include: { sections: { select: { id: true } }, zone: { select: { id: true, name: true } } },
          })
        : null;
      const type = ticket.ticketType;
      const zoneIds = type.zones.map((z) => z.id);
      // Una puerta de salida, o de ida y vuelta con la entrada adentro: es una salida (ni zonas ni horario).
      const exiting = gate?.direction === "OUT" || (gate?.direction === "BOTH" && ticket.inside);
      const deadline = entryDeadlineOf(ticket);
      const canReenter = ticket.status === "USED" && !ticket.inside && (type.maxEntries === 0 || ticket.entries < type.maxEntries);
      if (exiting) {
        const { count } = await prisma.ticket.updateMany({
          where: { id: ticket.id, status: "USED", inside: true },
          data: { inside: false, zoneId: null, lastMovementAt: scannedAt },
        });
        if (count === 1) {
          result = "ACCEPTED";
          movement = "EXIT";
        } else result = ticket.status === "CANCELLED" ? "CANCELLED" : "NOT_INSIDE";
      } else if (
        // "Free hasta la 01:00" o el último ingreso de la función: después ya no entra (si ya había entrado y no
        // puede reingresar, sigue siendo "ya utilizada"). El horario propio del tipo de entrada manda sobre el de la función.
        deadline &&
        scannedAt > deadline &&
        (ticket.status === "VALID" || ticket.expiredAt !== null || canReenter)
      ) {
        result = "OUT_OF_HOURS";
      } else if (
        gate &&
        ((gate.sections.length > 0 && !gate.sections.some((s) => s.id === type.sectionId)) ||
          (gate.zoneId && zoneIds.length > 0 && !zoneIds.includes(gate.zoneId)))
      ) {
        result = "WRONG_GATE";
        const gates = await prisma.accessPoint.findMany({
          where: { venueId: gate.venueId, direction: { not: "OUT" } },
          orderBy: { name: "asc" },
          include: { sections: { select: { id: true } } },
        });
        allowedGates = gates
          .filter(
            (g) =>
              g.id !== gate.id &&
              (g.sections.length === 0 || g.sections.some((s) => s.id === type.sectionId)) &&
              (!g.zoneId || zoneIds.length === 0 || zoneIds.includes(g.zoneId)),
          )
          .map((g) => g.name);
      } else {
        // Una lectura sin conexión hecha a tiempo vale aunque la entrada haya vencido mientras se sincronizaba.
        const inTime = deadline !== null && scannedAt <= deadline;
        const zone = gate?.zone ?? null;
        const first = await prisma.ticket.updateMany({
          where: { id: ticket.id, OR: [{ status: "VALID" }, ...(inTime ? [{ status: "CANCELLED" as const, expiredAt: { not: null } }] : [])] },
          data: {
            status: "USED",
            usedAt: scannedAt,
            inside: true,
            zoneId: zone?.id ?? null,
            entries: 1,
            lastMovementAt: scannedAt,
            ...(inTime ? { cancelledAt: null, expiredAt: null } : {}),
          },
        });
        if (first.count === 1) {
          result = "ACCEPTED";
          movement = "ENTRY";
          zoneAfter = zone;
        } else {
          const current = await prisma.ticket.findUniqueOrThrow({
            where: { id: ticket.id },
            select: { status: true, inside: true, zoneId: true, entries: true },
          });
          const reenter = current.status === "USED" && !current.inside && (type.maxEntries === 0 || current.entries < type.maxEntries);
          if (current.status === "CANCELLED") result = "CANCELLED";
          else if (current.status === "USED" && current.inside && zone && current.zoneId !== zone.id) {
            // Ya adentro y pasa a otra zona (del general al VIP): cambio de zona, no cuenta como ingreso.
            const moved = await prisma.ticket.updateMany({
              where: { id: ticket.id, status: "USED", inside: true, zoneId: current.zoneId },
              data: { zoneId: zone.id, lastMovementAt: scannedAt },
            });
            result = moved.count === 1 ? "ACCEPTED" : "ALREADY_USED";
            if (moved.count === 1) {
              movement = "ZONE_CHANGE";
              zoneAfter = zone;
            }
          } else if (reenter) {
            const again = await prisma.ticket.updateMany({
              where: { id: ticket.id, status: "USED", inside: false, entries: current.entries },
              data: { inside: true, zoneId: zone?.id ?? null, entries: { increment: 1 }, lastMovementAt: scannedAt },
            });
            result = again.count === 1 ? "ACCEPTED" : "ALREADY_USED";
            if (again.count === 1) {
              movement = "REENTRY";
              zoneAfter = zone;
            }
          } else result = "ALREADY_USED";
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
        method: input.method,
        movement,
        zoneId: zoneAfter?.id,
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
          seat: tableLabel(ticket.ticketType.name, ticket.credit?.tableNumber, ticket.credit?.seat?.label) ?? ticket.seat?.label ?? null,
          section: ticket.seat?.section.name ?? null,
        }
      : null,
    previousEntry: previous ? { at: previous.scannedAt, accessPoint: previous.accessPoint?.name ?? null } : null,
    allowedGates,
    ...(movement ? { movement, zone: zoneAfter?.name ?? null } : {}),
    ...(proofNote ? { proofNote } : {}),
  };
}

/** Hasta cuándo puede entrar una entrada: el horario de su tipo o, si no tiene, el último ingreso de la función. */
function entryDeadlineOf(ticket: { ticketType: { entryUntil: Date | null }; session: { lastEntryAt: Date | null } }): Date | null {
  return ticket.ticketType.entryUntil ?? ticket.session.lastEntryAt;
}

/** Resultado de una lectura ya registrada (reenvío de la app de puerta). */
async function replayOutcome(scan: { result: ScanResult; ticketId: string | null }): Promise<ScanOutcome> {
  const ticket = scan.ticketId
    ? await prisma.ticket.findUnique({
        where: { id: scan.ticketId },
        include: {
          ticketType: true,
          seat: { include: { section: true } },
          session: { include: { event: true } },
          credit: { select: { tableNumber: true, seat: { select: { label: true } } } },
        },
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
          seat: tableLabel(ticket.ticketType.name, ticket.credit?.tableNumber, ticket.credit?.seat?.label) ?? ticket.seat?.label ?? null,
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
