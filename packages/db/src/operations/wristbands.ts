/**
 * Carga masiva de manillas NFC (manillas nuevas, sin dueño). Se arma un lote (función y tipo de entrada), se leen todas
 * seguidas y recién al confirmar existen en el sistema: una entrada por manilla, numerada y ya vinculada.
 *
 * Al confirmar se reutilizan los lotes de entradas impresas: respetan el cupo, tienen número de serie y pueden abrir la
 * puerta desde ya o recién al marcarse vendidas.
 *
 * Quién: crear, confirmar y descartar un lote (crea entradas) es del dueño y los administradores. Leer manillas en un
 * lote abierto, además, de los cajeros habilitados para canjear en esa función.
 */
import { MAX_PRINT_BATCH, findShortage, normalizeNfcUid, normalizePrefix, sanitizeNfcCard, serialNumber } from "@ticketera/core";
import { prisma } from "../client";
import { Prisma, type PrintMode } from "../generated/prisma/client";
import { canRedeemSession, type RedeemStaff } from "./nfc-redeem";
import { createPrintBatchTx } from "./printed";
import { DomainError, audit, loadInventory, type Db, type Tx } from "./shared";

export const canManageWristbands = (staff: Pick<RedeemStaff, "role">) => staff.role === "OWNER" || staff.role === "ADMIN";

const forbidden = () => new DomainError("NOT_ALLOWED", "Tu cuenta no puede cargar manillas en esta función.");

async function assertCanRead(staff: RedeemStaff, sessionId: string) {
  if (!(await canRedeemSession(staff, sessionId))) throw forbidden();
}

async function assertCanManage(staff: RedeemStaff, sessionId: string) {
  if (!canManageWristbands(staff)) throw new DomainError("NOT_ALLOWED", "Solo un administrador puede crear, confirmar o descartar lotes.");
  await assertCanRead(staff, sessionId);
}

/** El lote, solo si es de la organización de la cuenta (el de otra no existe). */
async function ownBatch(db: Db, staff: RedeemStaff, batchId: string) {
  const batch = await db.wristbandBatch.findFirst({ where: { id: batchId, session: { event: { organizationId: staff.organizationId } } } });
  if (!batch) throw new DomainError("NOT_FOUND", "Lote no encontrado.");
  return batch;
}

/** Dos lecturas (o dos confirmaciones) del mismo lote pasan en fila. */
async function lockBatch(tx: Tx, batchId: string) {
  await tx.$queryRaw`SELECT id FROM "WristbandBatch" WHERE id = ${batchId} FOR UPDATE`;
  return tx.wristbandBatch.findUniqueOrThrow({ where: { id: batchId } });
}

/** Tipos de entrada de una función para los que se pueden crear manillas, con los lugares que quedan. */
export async function wristbandTypes(sessionId: string, now = new Date()) {
  const types = await prisma.ticketType.findMany({
    where: { sessionId, accessMethods: { has: "NFC" }, kind: "ENTRY", qrMode: "STATIC", OR: [{ sectionId: null }, { section: { seatingMode: { not: "RESERVED" } } }] },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  const inventory = await loadInventory(prisma, sessionId, now);
  return types.map((t) => {
    const line = inventory.find((l) => l.ticketTypeId === t.id);
    return { ...t, available: line ? Math.max(0, line.capacity - line.used) : 0 };
  });
}

export async function listWristbandBatches(staff: RedeemStaff, sessionId: string) {
  await assertCanRead(staff, sessionId);
  return prisma.wristbandBatch.findMany({
    where: { sessionId, status: { not: "DISCARDED" } },
    orderBy: { createdAt: "desc" },
    include: { ticketType: { select: { name: true } }, createdBy: { select: { name: true } }, printBatch: { select: { prefix: true } }, _count: { select: { items: true } } },
  });
}

export async function createWristbandBatch(
  staff: RedeemStaff,
  input: { sessionId: string; ticketTypeId: string; name: string; mode: PrintMode; prefix?: string; expected?: number },
) {
  await assertCanManage(staff, input.sessionId);
  const name = input.name.trim().slice(0, 80);
  if (name.length < 2) throw new DomainError("INVALID_ITEMS", "Ponle un nombre al lote (ej. «VIP rojas»).");
  const prefix = input.prefix?.trim() ? normalizePrefix(input.prefix) : null;
  if (input.prefix?.trim() && !prefix) throw new DomainError("INVALID_ITEMS", "El prefijo lleva de 1 a 4 letras o números (ej. VIP).");
  if (input.expected !== undefined && (!Number.isInteger(input.expected) || input.expected < 1 || input.expected > MAX_PRINT_BATCH)) {
    throw new DomainError("INVALID_ITEMS", `La cantidad va de 1 a ${MAX_PRINT_BATCH}.`);
  }
  if (!(await wristbandTypes(input.sessionId)).some((t) => t.id === input.ticketTypeId)) {
    throw new DomainError("INVALID_ITEMS", "Ese tipo de entrada no sirve para manillas: necesita NFC y ser una entrada general.");
  }
  const batch = await prisma.wristbandBatch.create({
    data: { sessionId: input.sessionId, ticketTypeId: input.ticketTypeId, name, mode: input.mode, prefix, expected: input.expected ?? null, createdById: staff.id },
  });
  await audit(prisma, { actorType: "staff", actorId: staff.id, action: "wristband.batch_create", entity: "WristbandBatch", entityId: batch.id, data: { name, mode: input.mode } });
  return batch;
}

export type WristbandRow = { id: string; uid: string; /** Orden de lectura, desde 1. */ number: number; /** Solo en un lote confirmado. */ serial: string | null; code: string | null };

/** El lote con sus manillas en orden y, si ya se confirmó, el número y el código de cada una. */
export async function getWristbandBatch(staff: RedeemStaff, batchId: string) {
  const found = await ownBatch(prisma, staff, batchId);
  await assertCanRead(staff, found.sessionId);
  const batch = await prisma.wristbandBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: {
      ticketType: { select: { name: true } },
      session: { select: { id: true, eventId: true, startsAt: true, event: { select: { title: true } }, venue: { select: { name: true, timezone: true } } } },
      printBatch: { select: { prefix: true, tickets: { select: { serial: true, code: true, nfcUid: true } } } },
      items: { orderBy: { position: "asc" }, select: { id: true, uid: true } },
    },
  });
  const byUid = new Map((batch.printBatch?.tickets ?? []).map((t) => [t.nfcUid, t]));
  const rows: WristbandRow[] = batch.items.map((item, i) => {
    const ticket = byUid.get(item.uid);
    return { id: item.id, uid: item.uid, number: i + 1, serial: ticket?.serial ?? null, code: ticket?.code ?? null };
  });
  const available = (await wristbandTypes(batch.sessionId)).find((t) => t.id === batch.ticketTypeId)?.available ?? 0;
  return { batch, rows, available };
}

export type WristbandReadResult =
  | { ok: true; id: string; uid: string; count: number }
  | {
      ok: false;
      reason: "BATCH_CLOSED" | "INVALID_UID" | "ALREADY_IN_BATCH" | "IN_OTHER_BATCH" | "UID_IN_USE" | "FULL";
      /** ALREADY_IN_BATCH: su número. IN_OTHER_BATCH: el nombre del lote. UID_IN_USE: el código de la entrada. */
      detail?: string;
    };

/** Agrega una manilla leída al lote. Una manilla es de una sola entrada por función: si ya está en otro lado, se avisa. */
export async function addWristbandRead(staff: RedeemStaff, batchId: string, input: { uid: string; card?: unknown }, now = new Date()): Promise<WristbandReadResult> {
  const found = await ownBatch(prisma, staff, batchId);
  await assertCanRead(staff, found.sessionId);
  const uid = normalizeNfcUid(input.uid);
  if (!uid) return { ok: false, reason: "INVALID_UID" };

  return prisma.$transaction(async (tx): Promise<WristbandReadResult> => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status !== "OPEN") return { ok: false, reason: "BATCH_CLOSED" };

    const mine = await tx.wristbandItem.findUnique({ where: { batchId_uid: { batchId, uid } }, select: { position: true } });
    if (mine) {
      const number = await tx.wristbandItem.count({ where: { batchId, position: { lte: mine.position } } });
      return { ok: false, reason: "ALREADY_IN_BATCH", detail: String(number) };
    }
    const linked = await tx.ticket.findFirst({ where: { sessionId: batch.sessionId, nfcUid: uid }, select: { code: true } });
    if (linked) return { ok: false, reason: "UID_IN_USE", detail: linked.code };
    const other = await tx.wristbandItem.findFirst({ where: { uid, batch: { sessionId: batch.sessionId, status: "OPEN" } }, select: { batch: { select: { name: true } } } });
    if (other) return { ok: false, reason: "IN_OTHER_BATCH", detail: other.batch.name };

    const count = await tx.wristbandItem.count({ where: { batchId } });
    const inventory = await loadInventory(tx, batch.sessionId, now);
    if (count >= MAX_PRINT_BATCH || findShortage(inventory, [{ ticketTypeId: batch.ticketTypeId, quantity: count + 1 }])) return { ok: false, reason: "FULL" };

    const last = await tx.wristbandItem.aggregate({ where: { batchId }, _max: { position: true } });
    const item = await tx.wristbandItem.create({
      data: { batchId, uid, card: sanitizeNfcCard(uid, input.card) as Prisma.InputJsonValue, position: (last._max.position ?? 0) + 1, readById: staff.id, readAt: now },
    });
    return { ok: true, id: item.id, uid, count: count + 1 };
  });
}

/** Quita una manilla de un lote abierto (leída de más, dañada). */
export async function removeWristbandRead(staff: RedeemStaff, batchId: string, itemId: string) {
  const found = await ownBatch(prisma, staff, batchId);
  await assertCanRead(staff, found.sessionId);
  await prisma.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status !== "OPEN") throw new DomainError("INVALID_STATE", "El lote ya está cerrado.");
    await tx.wristbandItem.deleteMany({ where: { id: itemId, batchId } });
  });
}

export async function discardWristbandBatch(staff: RedeemStaff, batchId: string) {
  const found = await ownBatch(prisma, staff, batchId);
  await assertCanManage(staff, found.sessionId);
  await prisma.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status !== "OPEN") throw new DomainError("INVALID_STATE", "El lote ya está cerrado.");
    // Las lecturas se borran: esas manillas quedan libres.
    const { count } = await tx.wristbandItem.deleteMany({ where: { batchId } });
    await tx.wristbandBatch.update({ where: { id: batchId }, data: { status: "DISCARDED" } });
    await audit(tx, { actorType: "staff", actorId: staff.id, action: "wristband.batch_discard", entity: "WristbandBatch", entityId: batchId, data: { name: batch.name, reads: count } });
  });
}

/**
 * Crea las entradas del lote: una por manilla, numeradas en el orden en que se leyeron y ya vinculadas. Todo o nada: si
 * no hay cupo o alguna manilla se vinculó entretanto por otro lado, no se crea ninguna. Confirmar dos veces no duplica.
 */
export async function confirmWristbandBatch(staff: RedeemStaff, batchId: string, now = new Date()) {
  const found = await ownBatch(prisma, staff, batchId);
  await assertCanManage(staff, found.sessionId);

  return prisma.$transaction(
    async (tx) => {
      const batch = await lockBatch(tx, batchId);
      if (batch.status !== "OPEN") throw new DomainError("INVALID_STATE", batch.status === "CONFIRMED" ? "El lote ya estaba confirmado." : "El lote está descartado.");
      const items = await tx.wristbandItem.findMany({ where: { batchId }, orderBy: { position: "asc" } });
      if (items.length === 0) throw new DomainError("INVALID_ITEMS", "El lote todavía no tiene manillas.");

      const linked = await tx.ticket.findMany({
        where: { sessionId: batch.sessionId, nfcUid: { in: items.map((i) => i.uid) } },
        select: { nfcUid: true },
      });
      if (linked.length > 0) {
        const taken = new Set(linked.map((t) => t.nfcUid));
        const numbers = items.flatMap((item, i) => (taken.has(item.uid) ? [i + 1] : []));
        throw new DomainError("DUPLICATE", `Estas manillas ya se vincularon a otra entrada: n.º ${numbers.slice(0, 10).join(", ")}${numbers.length > 10 ? "…" : ""}. Quítalas del lote y confirma de nuevo.`);
      }

      const printed = await createPrintBatchTx(tx, {
        sessionId: batch.sessionId,
        ticketTypeId: batch.ticketTypeId,
        quantity: items.length,
        prefix: batch.prefix ?? undefined,
        mode: batch.mode,
        note: `Manillas: ${batch.name}`,
        label: "Manilla",
        staffId: staff.id,
        now,
      });
      const tickets = await tx.ticket.findMany({ where: { printBatchId: printed.id }, select: { id: true, serial: true } });
      tickets.sort((a, b) => serialNumber(a.serial!, printed.prefix)! - serialNumber(b.serial!, printed.prefix)!);

      // Un solo UPDATE para todo el lote: la manilla n.º i queda en la entrada n.º i.
      await tx.$executeRaw`
        UPDATE "Ticket" AS t
        SET "nfcUid" = v.uid, "nfcCard" = v.card::jsonb, "nfcLinkedAt" = ${now}, "nfcLinkedById" = ${staff.id}
        FROM unnest(${tickets.map((t) => t.id)}::text[], ${items.map((i) => i.uid)}::text[], ${items.map((i) => JSON.stringify(i.card ?? { uid: i.uid }))}::text[]) AS v(id, uid, card)
        WHERE t.id = v.id`;

      await tx.wristbandBatch.update({ where: { id: batchId }, data: { status: "CONFIRMED", confirmedAt: now, printBatchId: printed.id } });
      await audit(tx, {
        actorType: "staff",
        actorId: staff.id,
        action: "wristband.batch_confirm",
        entity: "WristbandBatch",
        entityId: batchId,
        data: { name: batch.name, quantity: items.length, prefix: printed.prefix, firstNumber: printed.firstNumber },
      });
      return { quantity: items.length, prefix: printed.prefix, firstNumber: printed.firstNumber };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
