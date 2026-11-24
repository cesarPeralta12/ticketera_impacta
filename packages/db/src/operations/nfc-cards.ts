import { Prisma } from "../generated/prisma/client";
import { normalizeNfcUid, sanitizeNfcCard, type NfcCardInfo } from "@ticketera/core";
import { prisma } from "../client";
import { canControlSession, type DoorStaff } from "./mobile";
import { recordAuditSafely, type AuditContext } from "./security";

/** Quién puede vincular tarjetas: el dueño y los administradores (igual que grabar pulseras). */
export const NFC_LINK_ROLES = ["OWNER", "ADMIN"] as const;

export type LinkNfcCardResult =
  | { ok: true; code: string; uid: string; replaced: boolean; previousUid: string | null; card: NfcCardInfo }
  | {
      ok: false;
      reason:
        | "FORBIDDEN"
        | "INVALID_UID"
        | "TICKET_NOT_FOUND"
        | "TICKET_INACTIVE"
        | "NFC_NOT_ENABLED"
        | "ALREADY_LINKED"
        | "UID_IN_USE";
      /** Para ALREADY_LINKED: el UID que ya tiene. Para UID_IN_USE: el código de la otra entrada. */
      detail?: string;
    };

/**
 * Vincula una tarjeta o manilla NFC a una entrada: guarda su número de serie (con el que la puerta la encuentra) y la
 * huella que leyó la app. No escribe nada en la tarjeta.
 *
 * - La entrada tiene que ser de esa función, estar vigente y su tipo tener NFC activado (si no, la puerta rechazaría la
 *   tarjeta al leerla).
 * - Una tarjeta pertenece a una sola entrada por función. Si ya es de otra, no se pisa.
 * - Una entrada con tarjeta no se cambia sin `replace`: es el caso de una tarjeta perdida. La anterior queda libre
 *   y deja de abrir la puerta.
 */
export async function linkNfcCard(
  staff: DoorStaff,
  input: { sessionId: string; code: string; uid: string; card?: unknown; replace?: boolean },
  context: AuditContext = {},
  now = new Date(),
): Promise<LinkNfcCardResult> {
  if (!(NFC_LINK_ROLES as readonly string[]).includes(staff.role)) return { ok: false, reason: "FORBIDDEN" };
  if (!(await canControlSession(staff, input.sessionId))) return { ok: false, reason: "FORBIDDEN" };

  const uid = normalizeNfcUid(input.uid);
  if (!uid) return { ok: false, reason: "INVALID_UID" };

  const code = input.code.replace(/-/g, "").toUpperCase();
  const ticket = await prisma.ticket.findFirst({
    where: { sessionId: input.sessionId, code },
    select: { id: true, code: true, status: true, nfcUid: true, ticketType: { select: { accessMethods: true } } },
  });
  if (!ticket) return { ok: false, reason: "TICKET_NOT_FOUND" };
  if (ticket.status !== "VALID") return { ok: false, reason: "TICKET_INACTIVE" };
  if (!ticket.ticketType.accessMethods.includes("NFC")) return { ok: false, reason: "NFC_NOT_ENABLED" };

  if (ticket.nfcUid === uid) {
    // La misma tarjeta otra vez: se actualiza la huella y no hay nada que decidir.
    const card = sanitizeNfcCard(uid, input.card);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { nfcCard: card as Prisma.InputJsonValue } });
    return { ok: true, code: ticket.code, uid, replaced: false, previousUid: ticket.nfcUid, card };
  }
  if (ticket.nfcUid && !input.replace) return { ok: false, reason: "ALREADY_LINKED", detail: ticket.nfcUid };

  const taken = await prisma.ticket.findFirst({ where: { sessionId: input.sessionId, nfcUid: uid, NOT: { id: ticket.id } }, select: { code: true } });
  if (taken) return { ok: false, reason: "UID_IN_USE", detail: taken.code };

  const card = sanitizeNfcCard(uid, input.card);
  try {
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { nfcUid: uid, nfcCard: card as Prisma.InputJsonValue, nfcLinkedAt: now, nfcLinkedById: staff.id },
    });
  } catch (error) {
    // Dos teléfonos vincularon la misma tarjeta a la vez: gana el primero (la clave única lo impide).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, reason: "UID_IN_USE" };
    throw error;
  }
  await recordAuditSafely({
    actorType: "staff",
    actorId: staff.id,
    organizationId: staff.organizationId,
    action: ticket.nfcUid ? "ticket.nfc_replaced" : "ticket.nfc_linked",
    entity: "Ticket",
    entityId: ticket.id,
    data: { code: ticket.code, uid, previousUid: ticket.nfcUid, model: card.model ?? null },
    context,
  });
  return { ok: true, code: ticket.code, uid, replaced: ticket.nfcUid !== null, previousUid: ticket.nfcUid, card };
}
