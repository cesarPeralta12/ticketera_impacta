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
 * Latidos: la página pregunta por su turno cada pocos segundos y eso se anota (lastSeenAt).
 * - Quien está esperando pero dejó de preguntar (cerró la pestaña) no cuenta: ni bloquea el
 *   primer lugar ni se le da un turno que nadie va a usar. Si vuelve a tiempo, conserva su lugar.
 * - Quien fue admitido pero se fue (no abre la compra ni sigue en ella) pierde el turno a los
 *   2 minutos en vez de retener el lugar los 10 minutos completos.
 * - Una persona = un lugar por función (aunque abra varias pestañas o navegadores).
 *
 * Para decenas de miles de personas en fila conviene migrar a Redis (sorted set);
 * la interfaz de este módulo no cambiaría.
 */
import { prisma } from "../client";
import { TX_OPTIONS, type Db } from "./shared";

export const QUEUE_TURN_MINUTES = 10;
export const DEFAULT_MAX_CONCURRENT = 50;
/** Esperando: si no pregunta en este tiempo, se salta (vuelve a contar apenas pregunte de nuevo). */
export const QUEUE_WAITING_STALE_SECONDS = 45;
/** Admitido: si no da señales en este tiempo, pierde el turno y se libera el lugar. */
export const QUEUE_ADMITTED_IDLE_SECONDS = 120;
/** Los lugares de quien dejó de esperar hace más de esto se borran. */
const QUEUE_PURGE_MINUTES = 60;

export type QueueStatus =
  | { state: "admitted"; expiresAt: Date }
  | { state: "waiting"; position: number; waiting: number }
  | { state: "finished" }
  | { state: "not_joined" };

const secondsAgo = (now: Date, seconds: number) => new Date(now.getTime() - seconds * 1000);

/**
 * Anota al comprador en la fila. Si su turno anterior ya terminó, vuelve al final.
 * Con `customerId`, una persona ocupa un solo lugar: si ya tenía uno desde otra pestaña o navegador,
 * ese lugar pasa a este navegador (conserva su posición).
 */
export async function joinQueue(sessionId: string, token: string, now = new Date(), customerId?: string) {
  let existing = await prisma.queueEntry.findUnique({ where: { sessionId_token: { sessionId, token } } });
  if (!existing && customerId) {
    const mine = await prisma.queueEntry.findFirst({
      where: { sessionId, customerId },
      orderBy: { joinedAt: "desc" },
    });
    if (mine) existing = await prisma.queueEntry.update({ where: { id: mine.id }, data: { token } });
  }
  if (!existing) {
    await prisma.queueEntry.create({ data: { sessionId, token, joinedAt: now, lastSeenAt: now, customerId } });
    return;
  }
  const finished = existing.completedAt !== null || (existing.expiresAt !== null && existing.expiresAt <= now);
  await prisma.queueEntry.update({
    where: { id: existing.id },
    data: finished
      ? { joinedAt: now, admittedAt: null, expiresAt: null, completedAt: null, lastSeenAt: now, customerId }
      : { lastSeenAt: now, ...(customerId ? { customerId } : {}) },
  });
}

/** Deja pasar a los siguientes de la fila mientras haya cupo. */
async function admitNext(sessionId: string, maxConcurrent: number, now: Date) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))::text AS locked`;
    // Limpieza: quien dejó de esperar hace mucho no vuelve.
    await tx.queueEntry.deleteMany({
      where: { sessionId, admittedAt: null, lastSeenAt: { lt: secondsAgo(now, QUEUE_PURGE_MINUTES * 60) } },
    });
    const active = await tx.queueEntry.count({
      where: {
        sessionId,
        admittedAt: { not: null },
        completedAt: null,
        expiresAt: { gt: now },
        lastSeenAt: { gt: secondsAgo(now, QUEUE_ADMITTED_IDLE_SECONDS) },
      },
    });
    const free = maxConcurrent - active;
    if (free <= 0) return;
    const next = await tx.queueEntry.findMany({
      where: { sessionId, admittedAt: null, lastSeenAt: { gt: secondsAgo(now, QUEUE_WAITING_STALE_SECONDS) } },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      take: free,
      select: { id: true },
    });
    if (next.length === 0) return;
    await tx.queueEntry.updateMany({
      where: { id: { in: next.map((n) => n.id) }, admittedAt: null },
      data: { admittedAt: now, expiresAt: new Date(now.getTime() + QUEUE_TURN_MINUTES * 60_000) },
    });
  }, TX_OPTIONS);
}

/**
 * Estado del comprador en la fila. Cada consulta cuenta como "sigo aquí" (latido).
 * Un admitido que llevaba mucho sin dar señales ya perdió su turno: se le avisa (finished)
 * y tiene que volver a la fila, en vez de colarse junto a quien ocupó su lugar.
 */
export async function getQueueStatus(sessionId: string, token: string, now = new Date()): Promise<QueueStatus> {
  const session = await prisma.eventSession.findUnique({
    where: { id: sessionId },
    select: { maxConcurrentCheckouts: true },
  });

  const before = await prisma.queueEntry.findUnique({ where: { sessionId_token: { sessionId, token } } });
  if (before) {
    const abandoned =
      before.admittedAt !== null &&
      before.completedAt === null &&
      before.lastSeenAt <= secondsAgo(now, QUEUE_ADMITTED_IDLE_SECONDS);
    await prisma.queueEntry.update({
      where: { id: before.id },
      data: abandoned ? { completedAt: now, lastSeenAt: now } : { lastSeenAt: now },
    });
  }

  await admitNext(sessionId, session?.maxConcurrentCheckouts ?? DEFAULT_MAX_CONCURRENT, now);

  const entry = await prisma.queueEntry.findUnique({ where: { sessionId_token: { sessionId, token } } });
  if (!entry) return { state: "not_joined" };
  if (entry.admittedAt) {
    return !entry.completedAt && entry.expiresAt && entry.expiresAt > now
      ? { state: "admitted", expiresAt: entry.expiresAt }
      : { state: "finished" };
  }

  // Solo cuentan los que siguen esperando de verdad (preguntaron hace poco).
  const live = { sessionId, admittedAt: null, lastSeenAt: { gt: secondsAgo(now, QUEUE_WAITING_STALE_SECONDS) } };
  const ahead = await prisma.queueEntry.count({
    where: { ...live, OR: [{ joinedAt: { lt: entry.joinedAt } }, { joinedAt: entry.joinedAt, id: { lt: entry.id } }] },
  });
  const waiting = await prisma.queueEntry.count({ where: live });
  return { state: "waiting", position: ahead + 1, waiting };
}

/** ¿Este comprador tiene un turno vigente para comprar en esta función? */
export async function hasActiveTurn(db: Db, sessionId: string, token: string | undefined, now: Date) {
  if (!token) return false;
  const entry = await db.queueEntry.findUnique({ where: { sessionId_token: { sessionId, token } } });
  // Además de vigente, tiene que seguir "presente": si dejó de dar señales, su lugar ya pudo pasar a otro.
  return Boolean(
    entry?.admittedAt &&
      !entry.completedAt &&
      entry.expiresAt &&
      entry.expiresAt > now &&
      entry.lastSeenAt > secondsAgo(now, QUEUE_ADMITTED_IDLE_SECONDS),
  );
}

/** El comprador ya creó su orden: su lugar queda libre para el siguiente de la fila. */
export async function completeTurn(db: Db, sessionId: string, token: string, now: Date) {
  await db.queueEntry.updateMany({
    where: { sessionId, token, admittedAt: { not: null }, completedAt: null },
    data: { completedAt: now },
  });
}
