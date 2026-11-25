"use server";

import { formatCode, normalizeNfcUid } from "@ticketera/core";
import { findTicketForRedeem, linkNfcCard, type RedeemTicket } from "@ticketera/db";
import { requestContext } from "@/lib/client-ip";
import { ROLES, requireEditor, type Staff } from "@/lib/session";

const LOOKUP_ERRORS = {
  FORBIDDEN: "Tu cuenta no puede canjear en esta función.",
  NOT_FOUND: "No encontramos una entrada con ese código.",
  WRONG_SESSION: "Esa entrada es de otra función.",
  CANCELLED: "Esa entrada está anulada.",
  USED: "Esa entrada ya se usó para ingresar.",
  NFC_NOT_ENABLED: "Este tipo de entrada no tiene NFC activado: la puerta no aceptaría la tarjeta.",
  QR_NOT_VALID: "Esta entrada usa un QR que cambia: pide al cliente que lo abra en su celular y léelo en ese momento.",
} as const;

const LINK_ERRORS = {
  FORBIDDEN: LOOKUP_ERRORS.FORBIDDEN,
  INVALID_UID: "No se pudo leer el número de serie de la tarjeta. Acércala de nuevo; los teléfonos y las tarjetas virtuales no sirven.",
  TICKET_NOT_FOUND: "Esa entrada no existe en esta función.",
  TICKET_INACTIVE: "La entrada está anulada o ya se usó.",
  NFC_NOT_ENABLED: LOOKUP_ERRORS.NFC_NOT_ENABLED,
  ALREADY_LINKED: "Esta entrada ya tiene una tarjeta vinculada.",
  UID_IN_USE: "Esta tarjeta ya está vinculada a otra entrada de la función",
} as const;

const redeemStaff = (staff: Staff) => ({ id: staff.id, role: staff.role, organizationId: staff.organization.id });

export type LookupState = { ok: true; ticket: RedeemTicket } | { ok: false; error: string };

/** La entrada que corresponde al QR, código de barras o código escrito. */
export async function lookupRedeemAction(sessionId: string, raw: string): Promise<LookupState> {
  const staff = await requireEditor(ROLES.pos);
  const value = String(raw).trim();
  if (!value || value.length > 600) return { ok: false, error: LOOKUP_ERRORS.NOT_FOUND };
  const result = await findTicketForRedeem(redeemStaff(staff), String(sessionId), value);
  return result.ok ? result : { ok: false, error: LOOKUP_ERRORS[result.reason] };
}

export type LinkState = { ok: true; uid: string; replaced: boolean } | { ok: false; error: string };

/** Vincula la tarjeta leída (con el NFC del teléfono o un lector USB) a la entrada. El servidor vuelve a verificar todo. */
export async function linkRedeemAction(input: { sessionId: string; code: string; uid: string; source: "PHONE" | "USB"; replace: boolean }): Promise<LinkState> {
  const staff = await requireEditor(ROLES.pos);
  const uid = normalizeNfcUid(String(input.uid));
  if (!uid) return { ok: false, error: LINK_ERRORS.INVALID_UID };
  const result = await linkNfcCard(
    redeemStaff(staff),
    {
      sessionId: String(input.sessionId),
      code: String(input.code),
      uid,
      card: { tech: [input.source === "PHONE" ? "NFC del teléfono (web)" : "Lector USB (web)"] },
      replace: input.replace === true,
    },
    await requestContext(),
  );
  if (result.ok) return { ok: true, uid: result.uid, replaced: result.replaced };
  if (result.reason !== "UID_IN_USE") return { ok: false, error: LINK_ERRORS[result.reason] };
  const other = result.detail ? ` (${formatCode(result.detail)})` : "";
  return { ok: false, error: `${LINK_ERRORS.UID_IN_USE}${other}. Usa otra.` };
}
