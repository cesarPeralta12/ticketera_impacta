/**
 * Modo del QR de un tipo de entrada: fijo (STATIC) o que cambia cada 30 segundos (DYNAMIC, ver docs/qr-dinamico.md).
 */
import type { QrMode } from "../generated/prisma/client";
import { prisma } from "../client";

export type SetQrModeResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "NOT_FOUND" | "HAS_SALES" | "GUEST_LIST" };

/**
 * Cambia el modo del QR de un tipo de entrada de la organización.
 *
 * - Solo mientras el tipo no tenga ventas: las entradas ya emitidas se entregaron en un formato y cambiarlo
 *   las dejaría sin QR válido.
 * - DYNAMIC exige solo QR (sin código de barras ni NFC, que son fijos) y un evento de venta (no lista de invitados).
 */
export async function setTicketTypeQrMode(ticketTypeId: string, organizationId: string, mode: QrMode): Promise<SetQrModeResult> {
  const type = await prisma.ticketType.findFirst({
    where: { id: ticketTypeId, session: { event: { organizationId } } },
    select: { qrMode: true, session: { select: { event: { select: { mode: true } } } }, _count: { select: { orderItems: true, tickets: true } } },
  });
  if (!type) return { ok: false, reason: "NOT_FOUND" };
  if (type.qrMode === mode) return { ok: true, changed: false };
  if (type._count.orderItems > 0 || type._count.tickets > 0) return { ok: false, reason: "HAS_SALES" };
  if (mode === "DYNAMIC" && type.session.event.mode !== "TICKETING") return { ok: false, reason: "GUEST_LIST" };
  await prisma.ticketType.update({
    where: { id: ticketTypeId },
    data: { qrMode: mode, ...(mode === "DYNAMIC" ? { accessMethods: ["QR"] } : {}) },
  });
  return { ok: true, changed: true };
}
