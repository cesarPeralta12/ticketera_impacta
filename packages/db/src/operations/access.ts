import { parseTicketPayload } from "@ticketera/core";
import { prisma } from "../client";
import type { ScanResult } from "../generated/prisma/client";
import { requireEnv } from "./shared";

export type ScanOutcome = {
  result: ScanResult;
  ticket: { code: string; holderName: string | null; ticketType: string; event: string } | null;
  /** Para ALREADY_USED: cuándo y por dónde entró antes. */
  previousEntry: { at: Date; accessPoint: string | null } | null;
};

/**
 * Valida una entrada en puerta. La marca como usada con un único UPDATE condicional
 * (status = VALID): si dos puertas leen la misma entrada a la vez, solo una la acepta.
 * Toda lectura queda registrada en AccessScan, aceptada o no.
 */
export async function scanTicket(input: {
  sessionId: string;
  accessPointId?: string;
  operatorId?: string;
  raw: string;
  now?: Date;
}): Promise<ScanOutcome> {
  const now = input.now ?? new Date();
  const parsed = await parseTicketPayload(input.raw, requireEnv("TICKET_QR_SECRET"));

  let result: ScanResult = "INVALID";
  let ticket = null;

  if (parsed.ok) {
    const { count } = await prisma.ticket.updateMany({
      where: { code: parsed.code, sessionId: input.sessionId, status: "VALID" },
      data: { status: "USED", usedAt: now },
    });
    ticket = await prisma.ticket.findUnique({
      where: { code: parsed.code },
      include: { ticketType: true, session: { include: { event: true } } },
    });
    if (count === 1) result = "ACCEPTED";
    else if (!ticket) result = "NOT_FOUND";
    else if (ticket.sessionId !== input.sessionId) result = "WRONG_SESSION";
    else if (ticket.status === "USED") result = "ALREADY_USED";
    else if (ticket.status === "CANCELLED") result = "CANCELLED";
  }

  const previous =
    result === "ALREADY_USED" && ticket
      ? await prisma.accessScan.findFirst({
          where: { ticketId: ticket.id, result: "ACCEPTED" },
          orderBy: { scannedAt: "asc" },
          include: { accessPoint: true },
        })
      : null;

  await prisma.accessScan.create({
    data: {
      sessionId: input.sessionId,
      ticketId: ticket?.id,
      accessPointId: input.accessPointId,
      operatorId: input.operatorId,
      result,
      rawCode: input.raw.slice(0, 200),
      scannedAt: now,
    },
  });

  return {
    result,
    ticket: ticket
      ? {
          code: ticket.code,
          holderName: ticket.holderName,
          ticketType: ticket.ticketType.name,
          event: ticket.session.event.title,
        }
      : null,
    previousEntry: previous ? { at: previous.scannedAt, accessPoint: previous.accessPoint?.name ?? null } : null,
  };
}

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
