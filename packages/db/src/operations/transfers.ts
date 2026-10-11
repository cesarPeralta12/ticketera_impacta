/**
 * Transferencia de entradas entre cuentas de compradores.
 *
 * El dueño le pasa una entrada a otra persona que ya tiene cuenta. La entrada recibe un
 * código (QR) nuevo y queda a nombre de quien la recibe; el código viejo queda registrado
 * y en puerta sale "transferida". Así una captura del QR anterior ya no sirve.
 */
import { randomCode } from "@ticketera/core";
import { prisma } from "../client";
import { DomainError, audit } from "./shared";

export async function transferTicket(input: {
  ticketId: string;
  fromCustomerId: string;
  toEmail: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const email = input.toEmail.trim().toLowerCase();

  return prisma.$transaction(async (tx) => {
    // Bloquea la entrada: dos transferencias (o una transferencia y la puerta) no se cruzan.
    await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${input.ticketId} FOR UPDATE`;
    const ticket = await tx.ticket.findUnique({
      where: { id: input.ticketId },
      include: { order: { select: { channel: true } }, session: { include: { event: true } } },
    });
    if (!ticket || ticket.customerId !== input.fromCustomerId) {
      throw new DomainError("NOT_FOUND", "Entrada no encontrada.");
    }
    if (ticket.status === "USED") throw new DomainError("INVALID_STATE", "Esta entrada ya se usó para entrar.");
    if (ticket.status !== "VALID") throw new DomainError("INVALID_STATE", "Esta entrada está anulada.");
    if (ticket.order.channel === "GUEST") {
      throw new DomainError("INVALID_STATE", "Las invitaciones son personales: no se pueden transferir.");
    }
    if (ticket.session.cancelledAt || ticket.session.event.status === "CANCELLED") {
      throw new DomainError("INVALID_STATE", "La función fue cancelada.");
    }
    if (ticket.session.startsAt <= now) {
      throw new DomainError("INVALID_STATE", "La función ya empezó: la entrada ya no se puede transferir.");
    }

    const recipient = await tx.customer.findUnique({ where: { email } });
    if (!recipient) {
      throw new DomainError(
        "NOT_FOUND",
        "No hay ninguna cuenta con ese email. La persona tiene que registrarse en Impacta primero.",
      );
    }
    if (recipient.id === input.fromCustomerId) {
      throw new DomainError("INVALID_STATE", "Esa es tu propia cuenta.");
    }

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: { code: randomCode(), customerId: recipient.id, holderName: recipient.name },
    });
    await tx.ticketTransfer.create({
      data: { ticketId: ticket.id, fromCustomerId: input.fromCustomerId, toCustomerId: recipient.id, oldCode: ticket.code },
    });
    await audit(tx, {
      actorType: "customer",
      actorId: input.fromCustomerId,
      action: "ticket.transfer",
      entity: "Ticket",
      entityId: ticket.id,
      data: { to: recipient.id },
    });
    return { ticket: updated, recipient: { name: recipient.name, email: recipient.email } };
  });
}
