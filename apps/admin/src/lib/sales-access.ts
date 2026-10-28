import { canSellSession, prisma, salesAccess } from "@ticketera/db";
import type { Staff } from "./session";

/**
 * ¿Esta cuenta puede vender (o cobrar en la barra) esta función? Los administradores e iPass, siempre; un cajero con
 * "solo lo asignado", solo sus funciones. Las acciones lo vuelven a verificar en el servidor al vender.
 */
export async function staffCanSell(staff: Staff, session: { id: string; eventId: string }) {
  return canSellSession(await salesAccess(prisma, staff.id, staff.organization.id), session);
}
