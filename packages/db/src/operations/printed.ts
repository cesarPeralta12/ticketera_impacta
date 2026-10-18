/**
 * Entradas impresas: lotes numerados de un tipo de entrada, sin comprador, para eventos donde se venden en mano
 * (vendedores, RRPP, puntos de venta).
 *
 * Cada entrada impresa es una orden propia de canal PRINTED (como las invitaciones): así descuenta su lugar del
 * cupo al crearse y lo libera si se anula. Su importe es 0 hasta que se marca vendida: recién ahí suma a la
 * recaudación (no se cuentan ingresos por imprimir). En el modo "activada al vender" no abre la puerta hasta
 * venderse: una fotocopia o una entrada robada sin vender no pasa.
 */
import {
  MAX_PRINT_BATCH,
  canMovePrinted,
  extractTicketCode,
  findShortage,
  formatSerial,
  nextPrefix,
  normalizePrefix,
  randomCode,
  serialNumber,
  type PrintSaleMethod,
  type PrintStateName,
} from "@ticketera/core";
import { prisma } from "../client";
import type { PrintMode } from "../generated/prisma/client";
import { DomainError, TX_OPTIONS, audit, loadInventory, lockInventory } from "./shared";

/** Correo de relleno de las órdenes de entradas impresas (no tienen comprador con cuenta). */
export const PRINTED_BUYER_EMAIL = "impresas@impacta.invalid";

/**
 * Crea un lote de N entradas impresas numeradas (A-0001…). Respeta el cupo del tipo y el aforo de su sección.
 * Solo entradas generales: una impresa no elige butaca ni es una mesa.
 */
export async function createPrintBatch(input: {
  sessionId: string;
  ticketTypeId: string;
  quantity: number;
  prefix?: string;
  mode: PrintMode;
  /** Precio de referencia en centavos (por defecto, el del tipo de entrada). */
  unitAmount?: number;
  note?: string;
  artId?: string | null;
  staffId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_PRINT_BATCH) {
    throw new DomainError("INVALID_ITEMS", `La cantidad va de 1 a ${MAX_PRINT_BATCH}.`);
  }
  const wantedPrefix = input.prefix?.trim() ? normalizePrefix(input.prefix) : null;
  if (input.prefix?.trim() && !wantedPrefix) throw new DomainError("INVALID_ITEMS", "El prefijo lleva de 1 a 4 letras o números (ej. A o VIP).");

  return prisma.$transaction(
    async (tx) => {
      await lockInventory(tx, [input.ticketTypeId]);
      const type = await tx.ticketType.findUnique({
        where: { id: input.ticketTypeId },
        include: { section: true, session: { include: { event: true } } },
      });
      if (!type || type.sessionId !== input.sessionId) throw new DomainError("INVALID_ITEMS", "Tipo de entrada no encontrado.");
      if (type.session.cancelledAt || type.session.event.status === "CANCELLED") throw new DomainError("NOT_ON_SALE", "La función está cancelada.");
      if (type.section?.seatingMode === "RESERVED") {
        throw new DomainError("INVALID_ITEMS", "Las entradas impresas son para entradas generales, no para butacas numeradas.");
      }
      if (type.kind === "TABLE") throw new DomainError("INVALID_ITEMS", "Las mesas no se imprimen en lote: véndelas en boletería.");
      if (type.qrMode === "DYNAMIC") throw new DomainError("INVALID_ITEMS", "Una entrada de QR dinámico no se puede imprimir (el QR cambia cada 30 s).");

      const shortage = findShortage(await loadInventory(tx, type.sessionId, now), [{ ticketTypeId: type.id, quantity: input.quantity }]);
      if (shortage) throw new DomainError("SOLD_OUT", `Solo quedan ${shortage.available} lugares en "${type.name}".`);

      const previous = await tx.printBatch.findMany({ where: { sessionId: type.sessionId }, select: { prefix: true, firstNumber: true, quantity: true } });
      const prefix = wantedPrefix ?? nextPrefix(previous.map((b) => b.prefix));
      // El mismo prefijo sigue la numeración (A-0101 después de A-0001…A-0100): la serie nunca se repite.
      const firstNumber = Math.max(0, ...previous.filter((b) => b.prefix === prefix).map((b) => b.firstNumber + b.quantity - 1)) + 1;

      if (input.artId) {
        const art = await tx.ticketArt.findFirst({ where: { id: input.artId, organizationId: type.session.event.organizationId } });
        if (!art) throw new DomainError("INVALID_ITEMS", "Diseño de entrada no encontrado.");
      }

      const batch = await tx.printBatch.create({
        data: {
          sessionId: type.sessionId,
          ticketTypeId: type.id,
          prefix,
          firstNumber,
          quantity: input.quantity,
          mode: input.mode,
          unitAmount: input.unitAmount ?? type.unitAmount,
          currency: type.currency,
          note: input.note?.trim() || null,
          artId: input.artId ?? null,
          createdById: input.staffId,
        },
      });
      const serials = Array.from({ length: input.quantity }, (_, i) => formatSerial(prefix, firstNumber + i));
      const orders = await tx.order.createManyAndReturn({
        data: serials.map((serial) => ({
          code: randomCode(),
          channel: "PRINTED" as const,
          issuedById: input.staffId,
          buyerName: `Entrada impresa ${serial}`,
          buyerEmail: PRINTED_BUYER_EMAIL,
          status: "PAID" as const,
          currency: type.currency,
          subtotalAmount: 0,
          feeAmount: 0,
          totalAmount: 0,
          expiresAt: now,
          // Sin fecha de pago hasta que se venda: no aparece como venta.
          paidAt: null,
        })),
        select: { id: true, buyerName: true },
      });
      const items = await tx.orderItem.createManyAndReturn({
        data: orders.map((o) => ({ orderId: o.id, ticketTypeId: type.id, quantity: 1, unitAmount: 0, name: type.name })),
        select: { id: true, orderId: true },
      });
      const itemByOrder = new Map(items.map((i) => [i.orderId, i.id]));
      await tx.ticket.createMany({
        data: orders.map((o) => ({
          code: randomCode(),
          orderId: o.id,
          orderItemId: itemByOrder.get(o.id)!,
          ticketTypeId: type.id,
          sessionId: type.sessionId,
          serial: o.buyerName.replace("Entrada impresa ", ""),
          printBatchId: batch.id,
          printState: "STOCK" as const,
        })),
      });
      await audit(tx, {
        actorType: "staff",
        actorId: input.staffId,
        action: "print.batch.create",
        entity: "PrintBatch",
        entityId: batch.id,
        data: { quantity: input.quantity, prefix, firstNumber, mode: input.mode },
      });
      return batch;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

export type PrintAction =
  | { type: "ASSIGN"; seller: string }
  | { type: "SELL"; method: PrintSaleMethod; /** Centavos; por defecto, el precio de referencia del lote. */ amount?: number }
  | { type: "RETURN" }
  | { type: "STOCK" }
  | { type: "VOID" };

const TARGET: Record<PrintAction["type"], PrintStateName> = { ASSIGN: "ASSIGNED", SELL: "SOLD", RETURN: "RETURNED", STOCK: "STOCK", VOID: "VOID" };

/**
 * Mueve entradas impresas de un lote: entregar a un vendedor, vender, devolver, volver a stock o anular. Se eligen
 * por rango de serie ("del 1 al 20") o por código (escrito o leído con el escáner). Las que no pueden cambiar
 * (ya usadas, ya vendidas, de otro lote) se informan sin frenar a las demás.
 */
export async function movePrintedTickets(input: {
  batchId: string;
  range?: { from: number; to: number };
  /** Códigos o QR leídos. */
  codes?: string[];
  action: PrintAction;
  staffId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const batch = await prisma.printBatch.findUnique({ where: { id: input.batchId } });
  if (!batch) throw new DomainError("NOT_FOUND", "Lote no encontrado.");
  if (input.action.type === "ASSIGN" && !input.action.seller.trim()) throw new DomainError("INVALID_ITEMS", "Escribe a quién se entregan.");
  const amount = input.action.type === "SELL" ? (input.action.amount ?? batch.unitAmount) : 0;
  if (input.action.type === "SELL" && (!Number.isInteger(amount) || amount < 0)) throw new DomainError("INVALID_ITEMS", "Precio inválido.");

  const codes = (input.codes ?? []).map((raw) => extractTicketCode(raw)).filter((c): c is string => Boolean(c));
  const tickets = await prisma.ticket.findMany({
    where: { printBatchId: batch.id, ...(input.codes ? { code: { in: codes } } : {}) },
    include: { order: true },
  });
  const chosen = input.range
    ? tickets.filter((t) => {
        const n = t.serial ? serialNumber(t.serial, batch.prefix) : null;
        return n !== null && n >= input.range!.from && n <= input.range!.to;
      })
    : tickets;
  const notInBatch = input.codes ? (input.codes.length - chosen.length) : 0;
  if (chosen.length === 0) {
    throw new DomainError("INVALID_ITEMS", input.codes ? "Ese código no es de este lote." : "No hay entradas de este lote en ese rango.");
  }

  const target = TARGET[input.action.type];
  const skipped: { serial: string; reason: string }[] = [];
  let moved = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const t of chosen.toSorted((a, b) => (a.serial ?? "").localeCompare(b.serial ?? ""))) {
        const state = (t.printState ?? "STOCK") as PrintStateName;
        if (!canMovePrinted(state, target, t.status === "USED")) {
          skipped.push({ serial: t.serial ?? t.code, reason: t.status === "USED" ? "ya entró" : `está ${state === "SOLD" ? "vendida" : state === "VOID" ? "anulada" : "en ese estado"}` });
          continue;
        }
        // Condición sobre el estado actual: si otra persona la movió a la vez, no se pisa.
        const base = { id: t.id, printState: t.printState };
        let count = 0;
        switch (input.action.type) {
          case "ASSIGN":
            ({ count } = await tx.ticket.updateMany({ where: base, data: { printState: "ASSIGNED", assignedTo: input.action.seller.trim(), assignedAt: now } }));
            break;
          case "RETURN":
            ({ count } = await tx.ticket.updateMany({ where: base, data: { printState: "RETURNED" } }));
            break;
          case "STOCK":
            ({ count } = await tx.ticket.updateMany({ where: base, data: { printState: "STOCK", assignedTo: null, assignedAt: null } }));
            break;
          case "SELL":
            ({ count } = await tx.ticket.updateMany({
              where: base,
              data: { printState: "SOLD", soldAt: now, soldById: input.staffId, soldMethod: input.action.method },
            }));
            if (count === 1) {
              await tx.order.update({ where: { id: t.orderId }, data: { subtotalAmount: amount, totalAmount: amount, paidAt: now } });
              await tx.payment.create({
                data: {
                  orderId: t.orderId,
                  provider: `impresa_${input.action.method.toLowerCase()}`,
                  providerPaymentId: `impresa_${t.id}`,
                  status: "APPROVED",
                  providerStatus: "vendida_en_mano",
                  amount,
                  currency: batch.currency,
                  approvedAt: now,
                },
              });
            }
            break;
          case "VOID":
            ({ count } = await tx.ticket.updateMany({
              where: { ...base, status: "VALID" },
              data: { printState: "VOID", status: "CANCELLED", cancelledAt: now },
            }));
            // La orden anulada libera el lugar y, si estaba vendida, saca su importe de la recaudación.
            if (count === 1) await tx.order.update({ where: { id: t.orderId }, data: { status: "CANCELLED" } });
            break;
        }
        if (count === 1) moved++;
        else skipped.push({ serial: t.serial ?? t.code, reason: "cambió mientras tanto" });
      }
      await audit(tx, {
        actorType: "staff",
        actorId: input.staffId,
        action: `print.${input.action.type.toLowerCase()}`,
        entity: "PrintBatch",
        entityId: batch.id,
        severity: input.action.type === "VOID" ? "warn" : "info",
        data: {
          moved,
          ...(input.range ? { range: input.range } : {}),
          ...(input.action.type === "ASSIGN" ? { seller: input.action.seller } : {}),
          ...(input.action.type === "SELL" ? { method: input.action.method, amount } : {}),
        },
      });
    },
    { ...TX_OPTIONS, timeout: 120_000 },
  );
  return { moved, skipped, notInBatch };
}

/** Anota que se imprimieron (o reimprimieron) unas entradas: cada reimpresión queda en Seguridad. */
export async function recordPrinting(input: { ticketIds: string[]; staffId: string; scope: string }) {
  if (input.ticketIds.length === 0) return { reprinted: 0 };
  const reprinted = await prisma.ticket.count({ where: { id: { in: input.ticketIds }, printedCount: { gt: 0 } } });
  await prisma.ticket.updateMany({ where: { id: { in: input.ticketIds } }, data: { printedCount: { increment: 1 } } });
  await audit(prisma, {
    actorType: "staff",
    actorId: input.staffId,
    action: reprinted > 0 ? "print.reprint" : "print.print",
    entity: "Ticket",
    entityId: input.ticketIds[0]!,
    severity: reprinted > 0 ? "warn" : "info",
    data: { count: input.ticketIds.length, reprinted, scope: input.scope },
  });
  return { reprinted };
}

/** Rendición de un vendedor: registra cuánto entregó contra lo que vendió. */
export async function settlePrintedSeller(input: { batchId: string; seller: string; receivedAmount: number; note?: string; staffId: string }) {
  const seller = input.seller.trim();
  if (!seller) throw new DomainError("INVALID_ITEMS", "Elige el vendedor.");
  if (!Number.isInteger(input.receivedAmount) || input.receivedAmount < 0) throw new DomainError("INVALID_ITEMS", "Monto inválido.");
  const report = await getPrintBatchReport(input.batchId);
  if (!report) throw new DomainError("NOT_FOUND", "Lote no encontrado.");
  const line = report.sellers.find((s) => s.seller === seller);
  if (!line) throw new DomainError("INVALID_ITEMS", "Ese vendedor no tiene entradas de este lote.");
  const settlement = await prisma.printSettlement.create({
    data: {
      batchId: input.batchId,
      seller,
      sold: line.sold,
      returned: line.returned,
      expectedAmount: line.pending,
      receivedAmount: input.receivedAmount,
      note: input.note?.trim() || null,
      staffId: input.staffId,
    },
  });
  await audit(prisma, {
    actorType: "staff",
    actorId: input.staffId,
    action: "print.settle",
    entity: "PrintBatch",
    entityId: input.batchId,
    severity: input.receivedAmount !== line.pending ? "warn" : "info",
    data: { seller, expected: line.pending, received: input.receivedAmount },
  });
  return { settlement, difference: input.receivedAmount - line.pending };
}

/** Reporte del lote: cuántas en cada estado, usadas, recaudado y la cuenta de cada vendedor. */
export async function getPrintBatchReport(batchId: string) {
  const batch = await prisma.printBatch.findUnique({
    where: { id: batchId },
    include: {
      ticketType: { select: { name: true, accessMethods: true } },
      session: { include: { event: true, venue: true } },
      createdBy: { select: { name: true } },
      art: { select: { id: true, name: true } },
      settlements: { orderBy: { createdAt: "desc" }, include: { staff: { select: { name: true } } } },
      tickets: {
        orderBy: { serial: "asc" },
        select: {
          id: true,
          code: true,
          serial: true,
          status: true,
          usedAt: true,
          printState: true,
          assignedTo: true,
          soldAt: true,
          soldMethod: true,
          printedCount: true,
          order: { select: { totalAmount: true, status: true } },
        },
      },
    },
  });
  if (!batch) return null;
  const counts = { STOCK: 0, ASSIGNED: 0, SOLD: 0, RETURNED: 0, VOID: 0 } as Record<PrintStateName, number>;
  let used = 0;
  let revenue = 0;
  const sellers = new Map<string, { seller: string; assigned: number; inHand: number; sold: number; returned: number; soldAmount: number; received: number }>();
  for (const t of batch.tickets) {
    const state = (t.printState ?? "STOCK") as PrintStateName;
    counts[state]++;
    if (t.status === "USED") used++;
    const sold = state === "SOLD" && t.order.status === "PAID";
    if (sold) revenue += t.order.totalAmount;
    if (t.assignedTo) {
      const line = sellers.get(t.assignedTo) ?? { seller: t.assignedTo, assigned: 0, inHand: 0, sold: 0, returned: 0, soldAmount: 0, received: 0 };
      line.assigned++;
      if (state === "ASSIGNED") line.inHand++;
      if (state === "RETURNED") line.returned++;
      if (sold) {
        line.sold++;
        line.soldAmount += t.order.totalAmount;
      }
      sellers.set(t.assignedTo, line);
    }
  }
  for (const s of batch.settlements) {
    const line = sellers.get(s.seller);
    if (line) line.received += s.receivedAmount;
  }
  return {
    batch,
    counts,
    used,
    revenue,
    sellers: [...sellers.values()].map((s) => ({ ...s, pending: s.soldAmount - s.received })),
  };
}

/** Lotes de una función con su resumen (para la lista). */
export async function listPrintBatches(sessionId: string) {
  const batches = await prisma.printBatch.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    include: { ticketType: { select: { name: true } }, tickets: { select: { printState: true, status: true } } },
  });
  return batches.map((b) => ({
    id: b.id,
    prefix: b.prefix,
    firstNumber: b.firstNumber,
    quantity: b.quantity,
    mode: b.mode,
    typeName: b.ticketType.name,
    unitAmount: b.unitAmount,
    currency: b.currency,
    createdAt: b.createdAt,
    sold: b.tickets.filter((t) => t.printState === "SOLD").length,
    assigned: b.tickets.filter((t) => t.printState === "ASSIGNED").length,
    voided: b.tickets.filter((t) => t.printState === "VOID").length,
    used: b.tickets.filter((t) => t.status === "USED").length,
  }));
}
