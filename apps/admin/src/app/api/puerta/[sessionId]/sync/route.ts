import { getSessionSyncData } from "@ticketera/db";
import { doorSession } from "@/lib/door";
import { ROLES, can, currentStaff } from "@/lib/session";

/**
 * Lista completa de entradas de la función para la app de puerta: con ella sigue validando
 * si se corta internet. No incluye el secreto del QR.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const staff = await currentStaff();
  if (!staff || !can(staff, ROLES.access)) return Response.json({ error: "Sin permiso." }, { status: 403 });
  const session = await doorSession(staff, (await params).sessionId);
  if (!session) return Response.json({ error: "Función no encontrada." }, { status: 404 });
  const data = await getSessionSyncData(session.id);
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
