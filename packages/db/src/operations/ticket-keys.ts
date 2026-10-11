/**
 * Llave del QR dinámico de una entrada, para el celular de su dueño.
 *
 * La página de la entrada genera el QR en el celular (sin internet) con esta llave; por eso solo se entrega a
 * quien tiene la entrada ahora (si se transfirió, la llave cambia con el código) y cada entrega queda en el
 * registro de seguridad, con alerta si la misma entrada se abre desde demasiados aparatos.
 */
import { deriveTicketKey, toBase64Url } from "@ticketera/core";
import { prisma } from "../client";
import { recordAuditSafely, type AuditContext } from "./security";
import { requireEnv } from "./shared";

/** Cuánto después del inicio de la función sigue entregándose la llave (el evento ya terminó). */
const KEY_VALID_HOURS_AFTER_START = 24;
/** Aparatos distintos en 24 horas a partir de los cuales se avisa (una familia con 2–3 celulares es normal). */
export const KEY_DEVICE_ALERT = 4;

export type TicketKeyResult =
  | {
      ok: true;
      code: string;
      /** Llave (base64url) con la que el celular calcula la prueba del QR. */
      key: string;
      /** Hora del servidor: el celular mide su desfase para no depender de su reloj. */
      serverTime: string;
      /** Hasta cuándo sirve la llave guardada en el celular. */
      validUntil: string;
      status: "VALID" | "USED";
    }
  | { ok: false; reason: "NOT_FOUND" | "NOT_DYNAMIC" | "NOT_AVAILABLE" };

export async function issueTicketKey(
  customerId: string,
  code: string,
  context: AuditContext = {},
  now = new Date(),
): Promise<TicketKeyResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { code },
    include: { ticketType: { select: { qrMode: true } }, session: { select: { startsAt: true, cancelledAt: true, event: { select: { organizationId: true } } } }, order: { select: { status: true } } },
  });
  if (!ticket || ticket.customerId !== customerId) return { ok: false, reason: "NOT_FOUND" };
  if (ticket.ticketType.qrMode !== "DYNAMIC") return { ok: false, reason: "NOT_DYNAMIC" };

  const validUntil = new Date(ticket.session.startsAt.getTime() + KEY_VALID_HOURS_AFTER_START * 3_600_000);
  if (ticket.status === "CANCELLED" || ticket.session.cancelledAt || ticket.order.status !== "PAID" || now > validUntil) {
    return { ok: false, reason: "NOT_AVAILABLE" };
  }

  const key = toBase64Url(await deriveTicketKey(requireEnv("TICKET_QR_SECRET"), ticket.code));
  await recordAuditSafely({
    actorType: "customer",
    actorId: customerId,
    organizationId: ticket.session.event.organizationId,
    action: "ticket.key_issued",
    entity: "Ticket",
    entityId: ticket.id,
    data: { code: ticket.code },
    context,
  });
  await flagSharedKey(customerId, ticket.id, ticket.code, ticket.session.event.organizationId, context, now);

  return { ok: true, code: ticket.code, key, serverTime: now.toISOString(), validUntil: validUntil.toISOString(), status: ticket.status };
}

/** Si la llave de una entrada se pidió desde muchos aparatos en un día, queda una alerta (posible entrada compartida). */
async function flagSharedKey(customerId: string, ticketId: string, code: string, organizationId: string, context: AuditContext, now: Date) {
  try {
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const devices = await prisma.auditLog.findMany({
      where: { action: "ticket.key_issued", entityId: ticketId, createdAt: { gte: since } },
      distinct: ["userAgent"],
      select: { userAgent: true },
    });
    if (devices.length < KEY_DEVICE_ALERT) return;
    const alreadyFlagged = await prisma.auditLog.count({ where: { action: "auth.key_shared", entityId: ticketId, createdAt: { gte: since } } });
    if (alreadyFlagged > 0) return;
    await recordAuditSafely({
      actorType: "customer",
      actorId: customerId,
      organizationId,
      action: "auth.key_shared",
      entity: "Ticket",
      entityId: ticketId,
      severity: "warn",
      data: { code, devices: devices.length },
      context,
    });
  } catch (error) {
    console.error("[auditoría] no se pudo revisar las llaves compartidas", error);
  }
}
