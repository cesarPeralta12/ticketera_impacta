/**
 * Transferencia de entradas entre personas registradas.
 *
 * El titular ofrece una entrada a otra cuenta (por email o carnet); la otra persona la acepta o la
 * rechaza. Al aceptar, en una sola transacción:
 *  - la entrada recibe un código nuevo (el QR/barras anterior deja de valer, también en las puertas),
 *  - pasa a la cuenta de quien la aceptó, con su nombre y su carnet (lo que se ve en la puerta),
 *  - y cuenta una transferencia más (hay un máximo por entrada).
 * Mientras la oferta esté pendiente, la entrada sigue siendo del titular y puede usarla: si ingresa antes
 * de que la acepten, la oferta ya no se puede aceptar.
 */
import {
  MAX_TRANSFER_REQUESTS_PER_HOUR,
  isValidDocument,
  normalizeDocument,
  offerExpiry,
  randomCode,
  transferBlockReason,
  transferDeadline,
} from "@ticketera/core";
import { prisma } from "../client";
import { DomainError, audit } from "./shared";

const eventInclude = {
  session: { include: { event: { select: { title: true, transfersEnabled: true } }, venue: { select: { name: true, timezone: true } } } },
  ticketType: { select: { name: true, accessMethods: true, qrMode: true } },
  seat: { include: { section: { select: { name: true } } } },
} as const;

/** Datos del evento y de la entrada que se muestran en las pantallas y correos de una transferencia. */
function describe(ticket: {
  code: string;
  ticketType: { name: string; accessMethods: ("QR" | "BARCODE" | "NFC")[]; qrMode: "STATIC" | "DYNAMIC" };
  seat: { label: string; section: { name: string } } | null;
  session: { startsAt: Date; event: { title: string }; venue: { name: string; timezone: string } };
}) {
  return {
    code: ticket.code,
    typeName: ticket.ticketType.name,
    accessMethods: ticket.ticketType.accessMethods,
    /** DYNAMIC: no lleva QR fijo; se abre en el sitio, donde el QR cambia cada 30 segundos. */
    qrMode: ticket.ticketType.qrMode,
    seat: ticket.seat ? `${ticket.seat.section.name} · ${ticket.seat.label}` : null,
    eventTitle: ticket.session.event.title,
    startsAt: ticket.session.startsAt,
    venueName: ticket.session.venue.name,
    timezone: ticket.session.venue.timezone,
  };
}

/** Ofrece una entrada a otra persona registrada (por email o carnet). */
export async function createTransfer(input: {
  ticketId: string;
  fromCustomerId: string;
  to: { email?: string; document?: string };
  now?: Date;
}) {
  const now = input.now ?? new Date();

  // Cada pedido cuenta (aunque falle): así nadie prueba emails o carnets ajenos sin límite.
  const recent = await prisma.auditLog.count({
    where: { action: "transfer.request", actorId: input.fromCustomerId, createdAt: { gt: new Date(now.getTime() - 3_600_000) } },
  });
  if (recent >= MAX_TRANSFER_REQUESTS_PER_HOUR) {
    throw new DomainError("TRANSFER_NOT_ALLOWED", "Hiciste demasiados pedidos de transferencia. Intenta de nuevo en un rato.");
  }
  await prisma.auditLog.create({
    data: { actorType: "customer", actorId: input.fromCustomerId, action: "transfer.request", entity: "Ticket", entityId: input.ticketId },
  });

  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
    include: { ...eventInclude, transfers: { where: { status: "PENDING", expiresAt: { gt: now } }, select: { id: true } } },
  });
  if (!ticket || ticket.customerId !== input.fromCustomerId) {
    throw new DomainError("NOT_FOUND", "No encontramos esa entrada en tu cuenta.");
  }
  const blocked = transferBlockReason({
    status: ticket.status,
    transferCount: ticket.transferCount,
    startsAt: ticket.session.startsAt,
    eventTransfersEnabled: ticket.session.event.transfersEnabled,
    sessionCancelled: ticket.session.cancelledAt !== null,
    hasPendingTransfer: ticket.transfers.length > 0,
    now,
  });
  if (blocked) throw new DomainError("TRANSFER_NOT_ALLOWED", blocked);

  const email = input.to.email?.trim().toLowerCase();
  const document = input.to.document ? normalizeDocument(input.to.document) : undefined;
  if (!email && !(document && isValidDocument(document))) {
    throw new DomainError("RECIPIENT_NOT_FOUND", "Escribe el email o el carnet de la persona que recibirá la entrada.");
  }
  const recipient = await prisma.customer.findFirst({
    where: email ? { email } : { documentId: document },
    select: { id: true, name: true, email: true, emailVerified: true, documentId: true },
  });
  if (!recipient) {
    throw new DomainError(
      "RECIPIENT_NOT_FOUND",
      "No hay una cuenta con esos datos. Pídele a la persona que cree su cuenta en Impacta (necesita su carnet) y vuelve a intentar.",
    );
  }
  if (recipient.id === input.fromCustomerId) throw new DomainError("TRANSFER_NOT_ALLOWED", "No puedes transferirte una entrada a ti mismo.");
  if (!recipient.emailVerified || !recipient.documentId) {
    throw new DomainError("RECIPIENT_NOT_FOUND", "Esa cuenta todavía no confirmó su correo o no completó su carnet, así que no puede recibir entradas.");
  }

  const [transfer, from] = await Promise.all([
    prisma.ticketTransfer.create({
      data: {
        ticketId: ticket.id,
        fromCustomerId: input.fromCustomerId,
        toCustomerId: recipient.id,
        expiresAt: offerExpiry(now, ticket.session.startsAt),
      },
    }),
    prisma.customer.findUniqueOrThrow({ where: { id: input.fromCustomerId }, select: { name: true, email: true } }),
  ]);
  return { transfer, ticket: describe(ticket), from, to: { name: recipient.name, email: recipient.email } };
}

/**
 * La otra persona acepta: la entrada cambia de dueña y de código. Toda la operación es una transacción
 * con la entrada bloqueada, así que dos aceptaciones o un ingreso a la vez no pueden pisarse.
 */
export async function acceptTransfer(transferId: string, customerId: string, now = new Date()) {
  type Failure = { failed: { message: string; status: "EXPIRED" | "CANCELLED" } };
  const outcome = await prisma.$transaction(async (tx) => {
    const transfer = await tx.ticketTransfer.findUnique({ where: { id: transferId } });
    if (!transfer || transfer.toCustomerId !== customerId) throw new DomainError("NOT_FOUND", "No encontramos esa transferencia.");
    await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${transfer.ticketId} FOR UPDATE`;

    // Releer ya con la entrada bloqueada.
    const fresh = await tx.ticketTransfer.findUniqueOrThrow({ where: { id: transferId } });
    if (fresh.status !== "PENDING") throw new DomainError("INVALID_STATE", "Esta oferta ya no está disponible.");
    const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: fresh.ticketId }, include: eventInclude });

    // Si la oferta ya no se puede cumplir, se cierra (y queda registrado) en vez de seguir pendiente.
    const failure = (message: string, status: "EXPIRED" | "CANCELLED"): Failure => ({ failed: { message, status } });
    if (fresh.expiresAt <= now) return failure("La oferta venció.", "EXPIRED");
    if (ticket.status !== "VALID") return failure("La entrada ya no está disponible (se usó o se anuló).", "CANCELLED");
    if (ticket.customerId !== fresh.fromCustomerId) return failure("La entrada ya cambió de dueño.", "CANCELLED");
    if (now >= transferDeadline(ticket.session.startsAt)) return failure("Ya no se pueden transferir entradas de esta función.", "EXPIRED");

    const to = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    if (!to.emailVerified || !to.documentId) {
      throw new DomainError("INVALID_STATE", "Confirma tu correo y completa tu carnet para recibir entradas.");
    }

    let newCode = randomCode();
    while (await tx.ticket.findUnique({ where: { code: newCode }, select: { id: true } })) newCode = randomCode();
    const oldCode = ticket.code;

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        code: newCode,
        customerId: to.id,
        holderName: to.name,
        holderDocument: to.documentId,
        transferCount: { increment: 1 },
        transferredAt: now,
      },
      include: eventInclude,
    });
    await tx.ticketTransfer.update({ where: { id: transferId }, data: { status: "ACCEPTED", oldCode, newCode, resolvedAt: now } });
    await audit(tx, {
      actorType: "customer",
      actorId: customerId,
      action: "transfer.accept",
      entity: "Ticket",
      entityId: ticket.id,
      data: { from: fresh.fromCustomerId, to: customerId },
    });
    const from = await tx.customer.findUniqueOrThrow({ where: { id: fresh.fromCustomerId }, select: { name: true, email: true } });
    return { ticket: describe(updated), from, to: { name: to.name, email: to.email }, oldCode, newCode };
  });

  if ("failed" in outcome) {
    await prisma.ticketTransfer.updateMany({
      where: { id: transferId, status: "PENDING" },
      data: { status: outcome.failed.status, resolvedAt: now },
    });
    throw new DomainError("INVALID_STATE", outcome.failed.message);
  }
  return outcome;
}

/** La persona que recibe rechaza la oferta, o quien ofreció la cancela: la entrada sigue siendo suya. */
async function closeTransfer(transferId: string, customerId: string, who: "to" | "from", status: "DECLINED" | "CANCELLED", now: Date) {
  const where = {
    id: transferId,
    status: "PENDING" as const,
    ...(who === "to" ? { toCustomerId: customerId } : { fromCustomerId: customerId }),
  };
  const { count } = await prisma.ticketTransfer.updateMany({ where, data: { status, resolvedAt: now } });
  if (count !== 1) throw new DomainError("NOT_FOUND", "Esa oferta ya no está disponible.");
}

export const declineTransfer = (transferId: string, customerId: string, now = new Date()) =>
  closeTransfer(transferId, customerId, "to", "DECLINED", now);

export const cancelTransfer = (transferId: string, customerId: string, now = new Date()) =>
  closeTransfer(transferId, customerId, "from", "CANCELLED", now);

/** Ofertas pendientes de una cuenta: las que recibió y las que hizo. Las vencidas se cierran aquí. */
export async function listTransfers(customerId: string, now = new Date()) {
  await prisma.ticketTransfer.updateMany({
    where: { status: "PENDING", expiresAt: { lte: now }, OR: [{ toCustomerId: customerId }, { fromCustomerId: customerId }] },
    data: { status: "EXPIRED", resolvedAt: now },
  });
  const include = {
    ticket: { include: eventInclude },
    from: { select: { name: true } },
    to: { select: { name: true, email: true } },
  } as const;
  const [incoming, outgoing] = await Promise.all([
    prisma.ticketTransfer.findMany({ where: { toCustomerId: customerId, status: "PENDING" }, orderBy: { createdAt: "desc" }, include }),
    prisma.ticketTransfer.findMany({ where: { fromCustomerId: customerId, status: "PENDING" }, orderBy: { createdAt: "desc" }, include }),
  ]);
  const shape = (t: (typeof incoming)[number]) => ({
    id: t.id,
    expiresAt: t.expiresAt,
    fromName: t.from.name,
    toName: t.to.name,
    toEmail: t.to.email,
    ticketId: t.ticketId,
    ...describe(t.ticket),
  });
  return { incoming: incoming.map(shape), outgoing: outgoing.map(shape) };
}

/** Las entradas que esta cuenta tiene ahora (compradas o recibidas), con si se pueden transferir. */
export async function listCustomerTickets(customerId: string, now = new Date()) {
  const tickets = await prisma.ticket.findMany({
    where: { customerId, status: { in: ["VALID", "USED"] }, order: { status: "PAID" } },
    include: {
      ...eventInclude,
      transfers: { where: { status: "PENDING", expiresAt: { gt: now } }, select: { id: true, to: { select: { name: true, email: true } } } },
    },
    orderBy: [{ session: { startsAt: "asc" } }, { issuedAt: "asc" }],
  });
  return tickets.map((t) => ({
    id: t.id,
    status: t.status,
    holderName: t.holderName,
    receivedByTransfer: t.transferCount > 0,
    pending: t.transfers[0] ? { id: t.transfers[0].id, toName: t.transfers[0].to.name, toEmail: t.transfers[0].to.email } : null,
    blockedReason: transferBlockReason({
      status: t.status,
      transferCount: t.transferCount,
      startsAt: t.session.startsAt,
      eventTransfersEnabled: t.session.event.transfersEnabled,
      sessionCancelled: t.session.cancelledAt !== null,
      hasPendingTransfer: t.transfers.length > 0,
      now,
    }),
    ...describe(t),
  }));
}
