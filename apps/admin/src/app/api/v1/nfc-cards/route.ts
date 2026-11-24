import { z } from "zod";
import { linkNfcCard } from "@ticketera/db";
import { json, mobileContext, mobileStaff, passwordChangeRequired, readJson } from "@/lib/mobile-auth";

const bodySchema = z.object({
  sessionId: z.string().min(1).max(64),
  /** Código de la entrada (con o sin guion). */
  code: z.string().min(4).max(40),
  /** Número de serie de la tarjeta tal como lo leyó la app (con o sin dos puntos). */
  uid: z.string().min(1).max(60),
  /** Huella de la tarjeta (tipo de etiqueta, modelo, tecnologías…): se limpia en el servidor. */
  card: z.unknown().optional(),
  /** La entrada ya tenía una tarjeta (perdida o dañada): se reemplaza. */
  replace: z.boolean().optional(),
});

const REASONS = {
  FORBIDDEN: [403, "Tu cuenta no puede vincular tarjetas en esta función."],
  INVALID_UID: [400, "No se pudo leer el número de serie de la tarjeta. Acércala de nuevo; los teléfonos y las tarjetas virtuales no sirven."],
  TICKET_NOT_FOUND: [404, "Esa entrada no existe en esta función."],
  TICKET_INACTIVE: [409, "La entrada está anulada o ya se usó."],
  NFC_NOT_ENABLED: [409, "Este tipo de entrada no tiene NFC activado en el panel: la puerta no aceptaría la tarjeta."],
  ALREADY_LINKED: [409, "Esta entrada ya tiene una tarjeta vinculada."],
  UID_IN_USE: [409, "Esta tarjeta ya está vinculada a otra entrada de la función."],
} as const;

/**
 * Canje: vincula una tarjeta o manilla NFC a una entrada (guarda su número de serie; no se escribe nada en la tarjeta).
 * La puerta la reconoce después por ese número, que baja en la descarga de la función.
 */
export async function POST(req: Request) {
  const staff = await mobileStaff(req);
  if (!staff) return json({ error: "Sesión vencida." }, 401);
  if (staff.mustChangePassword) return passwordChangeRequired();
  const raw = await readJson(req);
  if (!raw.ok) return raw.response;
  const parsed = bodySchema.safeParse(raw.data);
  if (!parsed.success) return json({ error: "Datos inválidos." }, 400);

  const result = await linkNfcCard(staff, parsed.data, { ...mobileContext(req), deviceId: staff.deviceId, deviceName: staff.deviceName });
  if (!result.ok) {
    const [status, error] = REASONS[result.reason];
    return json({ error, code: result.reason, ...(result.detail ? { detail: result.detail } : {}) }, status);
  }
  return json({ ok: true, code: result.code, uid: result.uid, replaced: result.replaced, previousUid: result.previousUid });
}
