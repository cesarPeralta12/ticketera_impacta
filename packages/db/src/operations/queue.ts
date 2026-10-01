/**
 * Cola virtual (sala de espera) para funciones de alta demanda.
 *
 * Está en Postgres, así que es la misma para todos los servidores. La admisión se
 * serializa por función con un advisory lock: aunque mil navegadores pregunten a la vez,
 * nunca entran más compradores que el cupo simultáneo configurado.
 *
 * El turno se verifica también al crear la orden (createPendingOrder): no alcanza con
 * esconder el botón de compra, porque una server action se puede llamar directamente.
 *
 * Para decenas de miles de personas en fila conviene migrar a Redis (sorted set);
 * la interfaz de este módulo no cambiaría.
 */
import { prisma } from "../client";
import type { Db } from "./shared";

export const QUEUE_TURN_MINUTES = 10;
export const DEFAULT_MAX_CONCURRENT = 50;

export type QueueStatus =
  | { state: "admitted"; expiresAt: Date }
  | { state: "waiting"; position: number; waiting: number }
  | { state: "finished" }
  | { state: "not_joined" };

/** Anota al comprador en la fila. Si su turno anterior ya terminó, vuelve al final. */
export async function joinQueue(sessionId: string, token: string, now = new Date()) {
  const existing = await prisma.queueEntry.findUnique({ where: { sessionId_token: { sessionId, token } } });
  if (!existing) {
    await prisma.queueEntry.create({ data: { sessionId, token, joinedAt: now } });
    return;
  }
  const finished = existing.completedAt !== null || (existing.expiresAt !== null && existing.expiresAt <= now);
  if (finished) {
    await prisma.queueEntry.update({
      where: { id: existing.id },
      data: { joinedAt: now, admittedAt: null, expiresAt: null, completedAt: null },
    });
  }
}

/** Deja pasar a los siguientes de la fila mientras haya cupo. */
async function admitNext(sessionId: string, maxConcurrent: number, now: Date) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))::text AS locked`;
    const active = await tx.queueEntry.count({
      where: { sessionId, admittedAt: { not: null }, completedAt: null, expiresAt: { gt: now } },
    });
    const free = maxConcurrent - active;
    if (free <= 0) return;
    const next = await tx.queueEntry.findMany({
      where: { sessionId, admittedAt: null },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      take: free,
      select: { id: true },
    });
    if (next.length === 0) return;
    await tx.queueEntry.updateMany({
      where: { id: { in: next.map((n) => n.id) }, admittedAt: null },
      data: { admittedAt: now, expiresAt: new Date(now.getTime() + QUEUE_TURN_MINUTES * 60_000) },
    });
  });
}

export async function getQueueStatus(sessionId: string, token: string, now = new Date()): Promise<QueueStatus> {
  const session = await prisma.eventSession.findUnique({
    where: { id: sessionId },
    select: { maxConcurrentCheckouts: true },
  });
  await admitNext(sessionId, session?.maxConcurrentCheckouts ?? DEFAULT_MAX_CONCURRENT, now);

  const entry = await prisma.queueEntry.findUnique({ where: { sessionId_token: { sessionId, token } } });
  if (!entry) return { state: "not_joined" };
  if (entry.admittedAt) {
    return !entry.completedAt && entry.expiresAt && entry.expiresAt > now
      ? { state: "admitted", expiresAt: entry.expiresAt }
      : { state: "finished" };
  }

  const ahead = await prisma.queueEntry.count({
    where: {
      sessionId,
      admittedAt: null,
      OR: [{ joinedAt: { lt: entry.joinedAt } }, { joinedAt: entry.joinedAt, id: { lt: entry.id } }],
    },
  });
  const waiting = await prisma.queueEntry.count({ where: { sessionId, admittedAt: null } });
  return { state: "waiting", position: ahead + 1, waiting };
}

/** ¿Este comprador tiene un turno vigente para comprar en esta función? */
export async function hasActiveTurn(db: Db, sessionId: string, token: string | undefined, now: Date) {
  if (!token) return false;
  const entry = await db.queueEntry.findUnique({ where: { sessionId_token: { sessionId, token } } });
  return Boolean(entry?.admittedAt && !entry.completedAt && entry.expiresAt && entry.expiresAt > now);
}

/** El comprador ya creó su orden: su lugar queda libre para el siguiente de la fila. */
export async function completeTurn(db: Db, sessionId: string, token: string, now: Date) {
  await db.queueEntry.updateMany({
    where: { sessionId, token, admittedAt: { not: null }, completedAt: null },
    data: { completedAt: now },
  });
}
