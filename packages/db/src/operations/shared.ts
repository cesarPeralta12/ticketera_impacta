import type { InventoryLine } from "@ticketera/core";
import { Prisma, type PrismaClient } from "../generated/prisma/client";

export type Tx = Prisma.TransactionClient;
export type Db = Tx | PrismaClient;

/** Error de negocio con mensaje apto para mostrar al usuario. */
export class DomainError extends Error {
  constructor(
    readonly code:
      | "INVALID_ITEMS"
      | "NOT_ON_SALE"
      | "QUEUE_REQUIRED"
      | "SEAT_TAKEN"
      | "SOLD_OUT"
      | "ORDER_NOT_FOUND"
      | "ORDER_NOT_PAYABLE"
      | "ORDER_EXPIRED"
      | "PAYMENT_NOT_FOUND"
      | "PAYMENT_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}. Revisa el .env de la raíz.`);
  return value;
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function audit(
  db: Db,
  entry: {
    actorType: "staff" | "customer" | "system";
    actorId?: string;
    action: string;
    entity: string;
    entityId: string;
    data?: Prisma.InputJsonValue;
  },
) {
  await db.auditLog.create({ data: entry });
}

/**
 * Bloquea (SELECT ... FOR UPDATE) los tipos de entrada y sus secciones, siempre en el
 * mismo orden (primero tipos, luego secciones, cada grupo ordenado por id) para que dos
 * transacciones nunca se esperen mutuamente (deadlock).
 *
 * El bloqueo de la sección es el que impide sobrevender el aforo compartido: dos compras
 * de Preventa y General sobre la misma Cancha quedan en fila.
 */
export async function lockInventory(tx: Tx, ticketTypeIds: string[]) {
  const typeIds = [...new Set(ticketTypeIds)].sort();
  const types = await tx.$queryRaw<{ id: string; sectionId: string | null }[]>`
    SELECT id, "sectionId" FROM "TicketType" WHERE id = ANY(${typeIds}::text[]) ORDER BY id FOR UPDATE`;
  const sectionIds = [...new Set(types.flatMap((t) => (t.sectionId ? [t.sectionId] : [])))].sort();
  if (sectionIds.length > 0) {
    await tx.$queryRaw`SELECT id FROM "Section" WHERE id = ANY(${sectionIds}::text[]) ORDER BY id FOR UPDATE`;
  }
}

/**
 * Butacas (de las pedidas) que ya están vendidas o reservadas por otra orden vigente en
 * la función. Debe llamarse después de lockInventory para que el resultado siga siendo
 * cierto hasta el final de la transacción.
 */
export async function findTakenSeats(
  db: Db,
  sessionId: string,
  seatIds: string[],
  now: Date,
  excludeOrderId?: string,
): Promise<string[]> {
  if (seatIds.length === 0) return [];
  const items = await db.orderItem.findMany({
    where: {
      seatId: { in: seatIds },
      ticketType: { sessionId },
      order: {
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
        OR: [
          { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
          { status: "PENDING_PAYMENT", expiresAt: { gt: now } },
        ],
      },
    },
    select: { seatId: true },
  });
  return [...new Set(items.map((i) => i.seatId!))];
}

/** Entradas comprometidas por tipo en una función: vendidas + reservas vigentes. */
export async function loadInventory(
  db: Db,
  sessionId: string,
  now: Date,
  excludeOrderId?: string,
): Promise<InventoryLine[]> {
  const types = await db.ticketType.findMany({
    where: { sessionId },
    select: { id: true, name: true, capacity: true, sectionId: true, section: { select: { capacity: true } } },
  });
  const sums = await db.orderItem.groupBy({
    by: ["ticketTypeId"],
    where: {
      ticketType: { sessionId },
      order: {
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
        OR: [
          { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
          { status: "PENDING_PAYMENT", expiresAt: { gt: now } },
        ],
      },
    },
    _sum: { quantity: true },
  });
  const used = new Map(sums.map((s) => [s.ticketTypeId, s._sum.quantity ?? 0]));
  return types.map((t) => ({
    ticketTypeId: t.id,
    name: t.name,
    capacity: t.capacity,
    used: used.get(t.id) ?? 0,
    sectionId: t.sectionId,
    sectionCapacity: t.section?.capacity ?? null,
  }));
}
