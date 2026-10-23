/**
 * Entradas importadas desde Excel (canal IMPORT): lo vendido por otro medio o las cortesías de una planilla. El archivo
 * se revisa entero antes de tocar el cupo (lote en BORRADOR con errores por fila), se confirma todo junto o nada, y el
 * lote se puede deshacer (se anulan las entradas que no se usaron).
 */
import {
  findShortage,
  formatDateTime,
  importSessionLabel,
  matchImportSession,
  normalizeText,
  peopleIn,
  placeKey,
  randomCode,
  type ImportIssue,
  type ImportRow,
} from "@ticketera/core";
import { prisma } from "../client";
import { issueTickets } from "./payments";
import { DomainError, audit, findTakenSeats, loadInventory, lockInventory, type Db } from "./shared";

/** Fila lista para emitir: ya se sabe a qué función, tipo de entrada y lugar va. */
export type ResolvedImportRow = {
  line: number;
  sessionId: string;
  ticketTypeId: string;
  typeName: string;
  name: string;
  document: string | null;
  email: string | null;
  /** Centavos declarados como cobrados por fuera (0 = cortesía). */
  amount: number;
  seatId: string | null;
  /** Butaca o mesa como se muestra ("Fila F · 12", "Mesa 3"). */
  place: string | null;
  /** Mesa de una zona sin mapa con número elegido en la planilla. */
  tableNumber: number | null;
  /** Entradas que emite la fila: 1, o las personas de la mesa. */
  people: number;
};

export const MAX_IMPORT_TICKETS = 10_000;

/** Funciones del evento con su nombre en la plantilla ("1. vie, 20 nov 2026, 20:00 · Teatro") y sus tipos de entrada. */
export async function getImportContext(db: Db, eventId: string) {
  const sessions = await db.eventSession.findMany({
    where: { eventId },
    orderBy: { startsAt: "asc" },
    include: {
      venue: { select: { name: true, timezone: true } },
      ticketTypes: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          kind: true,
          qrMode: true,
          peoplePerUnit: true,
          currency: true,
          capacity: true,
          sectionId: true,
          section: { select: { name: true, seatingMode: true } },
        },
      },
    },
  });
  return sessions.map((s, i) => ({
    id: s.id,
    startsAt: s.startsAt,
    timeZone: s.venue.timezone,
    cancelled: Boolean(s.cancelledAt),
    label: importSessionLabel(i, formatDateTime(s.startsAt, s.venue.timezone), s.venue.name),
    ticketTypes: s.ticketTypes,
  }));
}

/** Butacas (o mesas del mapa) de una sección por su clave escrita a mano: "F-12", "Fila F 12", "Mesa 5", "5". */
async function seatIndex(db: Db, sectionId: string, tables: boolean) {
  const seats = await db.seat.findMany({ where: { sectionId }, select: { id: true, row: true, number: true, label: true } });
  const index = new Map<string, { id: string; label: string }[]>();
  const add = (key: string, seat: { id: string; label: string }) => {
    if (!key) return;
    const list = index.get(key) ?? [];
    if (!list.some((s) => s.id === seat.id)) list.push(seat);
    index.set(key, list);
  };
  for (const seat of seats) {
    add(placeKey(seat.label), seat);
    add(placeKey(`${seat.row} ${seat.number}`), seat);
    if (tables) add(placeKey(seat.number), seat);
  }
  return index;
}

/**
 * Revisa cada fila contra el evento: la función, el tipo de entrada, la butaca o mesa (que exista en el mapa y no se
 * repita) y después el cupo y lo ya vendido. Devuelve las filas listas y los errores y avisos por fila.
 */
export async function resolveImportRows(db: Db, input: { eventId: string; rows: ImportRow[]; now?: Date }) {
  const now = input.now ?? new Date();
  const sessions = await getImportContext(db, input.eventId);
  const resolved: ResolvedImportRow[] = [];
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const indexes = new Map<string, ReturnType<typeof seatIndex>>();
  const seatLines = new Map<string, number>();
  const tableLines = new Map<string, number>();

  for (const row of input.rows) {
    const fail = (message: string) => errors.push({ line: row.line, message });
    const session = matchImportSession(row.session, sessions);
    if (!session) {
      fail(row.session ? `La función "${row.session}" no existe: elígela de la lista de la plantilla.` : "Falta la función (el evento tiene varias).");
      continue;
    }
    if (session.cancelled) {
      fail("Esa función está cancelada.");
      continue;
    }
    const type = session.ticketTypes.find((t) => normalizeText(t.name) === normalizeText(row.type));
    if (!type) {
      fail(`El tipo de entrada "${row.type}" no existe en esa función.`);
      continue;
    }
    if (type.qrMode === "DYNAMIC") {
      fail(`"${type.name}" es de QR dinámico: vive en el celular del comprador y solo se vende online.`);
      continue;
    }

    let seatId: string | null = null;
    let place: string | null = null;
    let tableNumber: number | null = null;
    const noun = type.kind === "TABLE" ? "mesa" : "butaca";
    if (type.section?.seatingMode === "RESERVED") {
      if (!row.place) {
        fail(`"${type.name}" es numerada: falta la ${noun}.`);
        continue;
      }
      let index = indexes.get(type.sectionId!);
      if (!index) {
        index = seatIndex(db, type.sectionId!, type.kind === "TABLE");
        indexes.set(type.sectionId!, index);
      }
      const matches = (await index).get(placeKey(row.place)) ?? [];
      if (matches.length !== 1) {
        fail(
          matches.length === 0
            ? `La ${noun} "${row.place}" no existe en ${type.section.name}.`
            : `"${row.place}" puede ser ${matches.map((m) => m.label).join(" o ")}: escríbela como en el mapa.`,
        );
        continue;
      }
      const seat = matches[0]!;
      const previous = seatLines.get(seat.id);
      if (previous !== undefined) {
        fail(`${seat.label} está repetida (fila ${previous}).`);
        continue;
      }
      seatLines.set(seat.id, row.line);
      seatId = seat.id;
      place = seat.label;
    } else if (type.kind === "TABLE" && row.place) {
      const number = Number(/\d+/.exec(row.place)?.[0]);
      if (!Number.isInteger(number) || number < 1 || number > 10_000) {
        fail(`Mesa "${row.place}" no válida: escribe su número (ej. Mesa 5) o déjala vacía para numerarla sola.`);
        continue;
      }
      const key = `${type.id}:${number}`;
      const previous = tableLines.get(key);
      if (previous !== undefined) {
        fail(`La mesa ${number} de "${type.name}" está repetida (fila ${previous}).`);
        continue;
      }
      tableLines.set(key, row.line);
      tableNumber = number;
      place = `Mesa ${number}`;
    } else if (row.place) {
      warnings.push({ line: row.line, message: `"${type.name}" es entrada general: no lleva butaca (se ignora "${row.place}").` });
    }

    resolved.push({
      line: row.line,
      sessionId: session.id,
      ticketTypeId: type.id,
      typeName: type.name,
      name: row.name,
      document: row.document,
      email: row.email,
      amount: row.amount,
      seatId,
      place,
      tableNumber,
      people: peopleIn(type),
    });
  }

  const available = await checkAvailability(db, resolved, now);
  errors.push(...available.issues);

  // Aviso (no impide importar): ese carnet ya tiene entradas en el evento.
  const documents = [...new Set(available.rows.flatMap((r) => (r.document ? [r.document] : [])))];
  if (documents.length > 0) {
    const existing = await db.order.findMany({
      where: {
        buyerDocument: { in: documents },
        status: { in: ["PAID", "PARTIALLY_REFUNDED"] },
        items: { some: { ticketType: { session: { eventId: input.eventId } } } },
      },
      select: { buyerDocument: true, code: true },
    });
    const byDocument = new Map(existing.map((o) => [o.buyerDocument!, o.code]));
    for (const row of available.rows) {
      const code = row.document && byDocument.get(row.document);
      if (code) warnings.push({ line: row.line, message: `El carnet ${row.document} ya tiene entradas en este evento (orden ${code}).` });
    }
  }

  const byLine = (a: ImportIssue, b: ImportIssue) => a.line - b.line;
  return { rows: available.rows, errors: errors.sort(byLine), warnings: warnings.sort(byLine) };
}

/**
 * Lo que depende del momento: que las butacas y mesas sigan libres y que haya cupo (fila por fila, en orden: las
 * últimas son las que no entran). Se usa en la vista previa y otra vez al confirmar, con el inventario bloqueado.
 */
async function checkAvailability(db: Db, rows: ResolvedImportRow[], now: Date) {
  const issues: ImportIssue[] = [];
  const ok: ResolvedImportRow[] = [];
  for (const sessionId of new Set(rows.map((r) => r.sessionId))) {
    const sessionRows = rows.filter((r) => r.sessionId === sessionId);
    const taken = new Set(await findTakenSeats(db, sessionId, sessionRows.flatMap((r) => (r.seatId ? [r.seatId] : [])), now));
    const tables = sessionRows.filter((r) => r.tableNumber !== null);
    const usedTables =
      tables.length === 0
        ? new Set<string>()
        : new Set(
            (
              await db.consumptionCredit.findMany({
                where: { OR: tables.map((r) => ({ ticketTypeId: r.ticketTypeId, tableNumber: r.tableNumber })) },
                select: { ticketTypeId: true, tableNumber: true },
              })
            ).map((c) => `${c.ticketTypeId}:${c.tableNumber}`),
          );
    const inventory = await loadInventory(db, sessionId, now);
    const requested = new Map<string, number>();
    for (const row of sessionRows) {
      if (row.seatId && taken.has(row.seatId)) {
        issues.push({ line: row.line, message: `${row.place} ya está vendida o reservada.` });
        continue;
      }
      if (row.tableNumber !== null && usedTables.has(`${row.ticketTypeId}:${row.tableNumber}`)) {
        issues.push({ line: row.line, message: `La mesa ${row.tableNumber} de "${row.typeName}" ya está asignada.` });
        continue;
      }
      const next = new Map(requested).set(row.ticketTypeId, (requested.get(row.ticketTypeId) ?? 0) + 1);
      const shortage = findShortage(
        inventory,
        [...next].map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity })),
      );
      if (shortage) {
        issues.push({ line: row.line, message: `Sin cupo en "${shortage.name}": ya no quedan lugares para esta fila.` });
        continue;
      }
      requested.set(row.ticketTypeId, next.get(row.ticketTypeId)!);
      ok.push(row);
    }
  }
  return { rows: ok.sort((a, b) => a.line - b.line), issues };
}

/** Sube un archivo: queda en borrador con sus filas listas, los errores y los avisos (todavía no ocupa cupo). */
export async function createImportDraft(input: {
  eventId: string;
  staffId: string;
  fileName: string;
  parsed: { rows: ImportRow[]; errors: ImportIssue[]; total: number };
  now?: Date;
}) {
  const result = await resolveImportRows(prisma, { eventId: input.eventId, rows: input.parsed.rows, now: input.now });
  const errors = [...input.parsed.errors, ...result.errors].sort((a, b) => a.line - b.line);
  const ticketCount = result.rows.reduce((sum, r) => sum + r.people, 0);
  if (ticketCount > MAX_IMPORT_TICKETS) {
    errors.unshift({ line: 1, message: `El archivo emite ${ticketCount} entradas: el máximo por archivo es ${MAX_IMPORT_TICKETS}.` });
  }
  return prisma.importBatch.create({
    data: {
      eventId: input.eventId,
      staffId: input.staffId,
      fileName: input.fileName.slice(0, 200),
      rows: result.rows,
      errors,
      warnings: result.warnings,
      totalRows: input.parsed.total,
      validRows: ticketCount > MAX_IMPORT_TICKETS ? 0 : result.rows.length,
      ticketCount,
    },
  });
}

/** Filas por bloque al emitir: miles de filas una por una tardaban ~30 s con el inventario del evento bloqueado. */
const IMPORT_CHUNK = 500;

/**
 * Confirma un borrador: en una sola transacción, con el inventario bloqueado, vuelve a revisar butacas y cupo (pudo
 * venderse algo desde la vista previa) y emite todo o nada. Cada fila es una orden pagada del canal IMPORT.
 * Con una sola fila con error no se emite nada: se corrige el archivo y se vuelve a subir.
 */
export async function confirmImport(input: { batchId: string; staffId: string; now?: Date }) {
  const now = input.now ?? new Date();
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ImportBatch" WHERE id = ${input.batchId} FOR UPDATE`;
      const batch = await tx.importBatch.findUnique({ where: { id: input.batchId } });
      if (!batch) throw new DomainError("NOT_FOUND", "Importación no encontrada.");
      if (batch.status !== "DRAFT") {
        throw new DomainError("INVALID_STATE", batch.status === "CONFIRMED" ? "Esta importación ya se confirmó." : "Esta importación ya no se puede confirmar.");
      }
      const errors = batch.errors as ImportIssue[];
      if (errors.length > 0) {
        throw new DomainError("INVALID_ITEMS", `Hay ${errors.length} fila(s) con error: corrígelas y vuelve a subir el archivo. No se emitió ninguna entrada.`);
      }
      const rows = batch.rows as unknown as ResolvedImportRow[];
      if (rows.length === 0 || batch.validRows === 0) throw new DomainError("INVALID_ITEMS", "No hay filas válidas para importar.");

      const typeIds = [...new Set(rows.map((r) => r.ticketTypeId))];
      await lockInventory(tx, typeIds);
      const types = await tx.ticketType.findMany({
        where: { id: { in: typeIds } },
        select: {
          id: true,
          name: true,
          currency: true,
          sessionId: true,
          kind: true,
          peoplePerUnit: true,
          consumptionAmount: true,
          session: { select: { cancelledAt: true, eventId: true } },
        },
      });
      if (types.length !== typeIds.length || types.some((t) => t.session.eventId !== batch.eventId)) {
        throw new DomainError("INVALID_ITEMS", "Algún tipo de entrada ya no existe: vuelve a subir el archivo.");
      }
      if (types.some((t) => t.session.cancelledAt)) throw new DomainError("NOT_ON_SALE", "Una de las funciones se canceló.");
      const check = await checkAvailability(tx, rows, now);
      if (check.issues.length > 0) {
        const shown = check.issues.slice(0, 3).map((i) => `fila ${i.line}: ${i.message}`);
        throw new DomainError("SOLD_OUT", `Desde la vista previa cambió lo disponible (${shown.join(" ")}). Vuelve a subir el archivo.`);
      }

      const byId = new Map(types.map((t) => [t.id, t]));
      const orderData = (row: ResolvedImportRow, code = randomCode()) => {
        const type = byId.get(row.ticketTypeId)!;
        return {
          code,
          channel: "IMPORT" as const,
          issuedById: input.staffId,
          importBatchId: batch.id,
          buyerName: row.name,
          buyerEmail: row.email ?? "",
          buyerDocument: row.document,
          status: "PAID" as const,
          currency: type.currency,
          subtotalAmount: row.amount,
          feeAmount: 0,
          totalAmount: row.amount,
          expiresAt: now,
          paidAt: now,
        };
      };

      // Una entrada común (sin mesa ni consumo incluido) se emite por bloques: órdenes, líneas y entradas con un
      // INSERT por bloque. Mesas y consumos abren saldos y numeran mesas: van una por una con issueTickets.
      const plain = (row: ResolvedImportRow) => {
        const type = byId.get(row.ticketTypeId)!;
        return type.kind === "ENTRY" && !type.consumptionAmount;
      };
      const simpleRows = rows.filter(plain);
      for (let start = 0; start < simpleRows.length; start += IMPORT_CHUNK) {
        const chunk = simpleRows.slice(start, start + IMPORT_CHUNK).map((row) => ({ row, code: randomCode() }));
        const orders = await tx.order.createManyAndReturn({ data: chunk.map(({ row, code }) => orderData(row, code)), select: { id: true, code: true } });
        const orderIdByCode = new Map(orders.map((o) => [o.code, o.id]));
        const lines = chunk.map(({ row, code }) => ({ row, orderId: orderIdByCode.get(code)! }));
        const items = await tx.orderItem.createManyAndReturn({
          data: lines.map(({ row, orderId }) => ({
            orderId,
            ticketTypeId: row.ticketTypeId,
            seatId: row.seatId,
            quantity: 1,
            unitAmount: row.amount,
            name: byId.get(row.ticketTypeId)!.name,
          })),
          select: { id: true, orderId: true },
        });
        const itemIdByOrder = new Map(items.map((i) => [i.orderId, i.id]));
        await tx.ticket.createMany({
          data: lines.map(({ row, orderId }) => ({
            code: randomCode(),
            orderId,
            orderItemId: itemIdByOrder.get(orderId)!,
            ticketTypeId: row.ticketTypeId,
            sessionId: byId.get(row.ticketTypeId)!.sessionId,
            seatId: row.seatId,
            holderName: row.name,
          })),
        });
      }

      for (const row of rows.filter((r) => !plain(r))) {
        const type = byId.get(row.ticketTypeId)!;
        const order = await tx.order.create({
          data: {
            ...orderData(row),
            items: { create: { ticketTypeId: type.id, seatId: row.seatId, quantity: 1, unitAmount: row.amount, name: type.name } },
          },
          select: { id: true, customerId: true, buyerName: true, items: { select: { id: true, ticketTypeId: true, seatId: true, quantity: true } } },
        });
        await issueTickets(
          tx,
          { ...order, items: order.items.map((item) => ({ ...item, ticketType: type })) },
          row.tableNumber !== null ? new Map([[order.items[0]!.id, row.tableNumber]]) : undefined,
        );
      }
      const confirmed = await tx.importBatch.update({ where: { id: batch.id }, data: { status: "CONFIRMED", confirmedAt: now } });
      await audit(tx, {
        actorType: "staff",
        actorId: input.staffId,
        action: "import.confirm",
        entity: "ImportBatch",
        entityId: batch.id,
        data: { orders: rows.length, tickets: batch.ticketCount },
      });
      return confirmed;
    },
    { maxWait: 15_000, timeout: 300_000 },
  );
}

/** Descarta un borrador (no había ocupado cupo). */
export async function discardImport(input: { batchId: string; staffId: string }) {
  const { count } = await prisma.importBatch.updateMany({ where: { id: input.batchId, status: "DRAFT" }, data: { status: "DISCARDED" } });
  if (count === 0) throw new DomainError("INVALID_STATE", "Solo se descarta una importación sin confirmar.");
}

/**
 * Deshace una importación confirmada: anula las entradas que no se usaron y libera su cupo. Las que ya entraron
 * quedan (esa persona ya está adentro) y su orden sigue ocupando su lugar.
 */
export async function undoImport(input: { batchId: string; staffId: string; now?: Date }) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ImportBatch" WHERE id = ${input.batchId} FOR UPDATE`;
    const batch = await tx.importBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new DomainError("NOT_FOUND", "Importación no encontrada.");
    if (batch.status !== "CONFIRMED") throw new DomainError("INVALID_STATE", "Solo se deshace una importación confirmada.");
    const { count: cancelled } = await tx.ticket.updateMany({
      where: { order: { importBatchId: batch.id }, status: "VALID" },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    const used = await tx.ticket.count({ where: { order: { importBatchId: batch.id }, status: "USED" } });
    await tx.order.updateMany({
      where: { importBatchId: batch.id, status: "PAID", tickets: { none: { status: "USED" } } },
      data: { status: "CANCELLED" },
    });
    await tx.importBatch.update({ where: { id: batch.id }, data: { status: "UNDONE", undoneAt: now } });
    await audit(tx, {
      actorType: "staff",
      actorId: input.staffId,
      action: "import.undo",
      entity: "ImportBatch",
      entityId: batch.id,
      data: { cancelled, used },
      severity: "warn",
    });
    return { cancelled, used };
  });
}

export async function listImportBatches(eventId: string) {
  return prisma.importBatch.findMany({
    where: { eventId, status: { not: "DISCARDED" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      fileName: true,
      status: true,
      totalRows: true,
      validRows: true,
      ticketCount: true,
      createdAt: true,
      confirmedAt: true,
      undoneAt: true,
      staff: { select: { name: true } },
    },
  });
}

/** Una importación con lo que pasó después: entradas por estado, lo declarado como cobrado y los correos. */
export async function getImportSummary(batchId: string) {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId }, include: { staff: { select: { name: true } } } });
  if (!batch) return null;
  const [byStatus, revenue, toEmail, emailed, withoutEmail] = await Promise.all([
    prisma.ticket.groupBy({ by: ["status"], where: { order: { importBatchId: batchId } }, _count: true }),
    prisma.order.aggregate({ where: { importBatchId: batchId, status: "PAID" }, _sum: { totalAmount: true } }),
    prisma.order.count({ where: { importBatchId: batchId, status: "PAID", buyerEmail: { not: "" }, ticketsEmailedAt: null } }),
    prisma.order.count({ where: { importBatchId: batchId, ticketsEmailedAt: { not: null } } }),
    prisma.order.count({ where: { importBatchId: batchId, status: "PAID", buyerEmail: "" } }),
  ]);
  const count = (status: string) => byStatus.find((s) => s.status === status)?._count ?? 0;
  return {
    batch: {
      ...batch,
      rows: batch.rows as unknown as ResolvedImportRow[],
      errors: batch.errors as ImportIssue[],
      warnings: batch.warnings as ImportIssue[],
    },
    tickets: { valid: count("VALID"), used: count("USED"), cancelled: count("CANCELLED") },
    revenue: revenue._sum.totalAmount ?? 0,
    email: { pending: toEmail, sent: emailed, without: withoutEmail },
  };
}

/** Órdenes de la importación que tienen correo y todavía no recibieron sus entradas. */
export async function importOrdersToEmail(batchId: string, take: number) {
  return prisma.order.findMany({
    where: { importBatchId: batchId, status: "PAID", buyerEmail: { not: "" }, ticketsEmailedAt: null },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true, code: true },
  });
}

export async function markTicketsEmailed(orderIds: string[], now = new Date()) {
  if (orderIds.length > 0) await prisma.order.updateMany({ where: { id: { in: orderIds } }, data: { ticketsEmailedAt: now } });
}
