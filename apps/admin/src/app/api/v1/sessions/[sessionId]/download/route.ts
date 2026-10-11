import { canControlSession, getDoorDownload } from "@ticketera/db";
import { json, mobileStaff, passwordChangeRequired } from "@/lib/mobile-auth";

/**
 * Descarga de datos para validar sin internet. `?gate=<id>` elige la puerta (si el portero
 * tiene una asignada, se usa esa) y `?since=<ISO>` pide solo los cambios desde esa hora.
 */
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const staff = await mobileStaff(req);
  if (!staff) return json({ error: "Sesión vencida." }, 401);
  if (staff.mustChangePassword) return passwordChangeRequired();
  const { sessionId } = await params;
  const allowed = await canControlSession(staff, sessionId);
  if (!allowed) return json({ error: "Función no disponible para tu cuenta." }, 403);

  const url = new URL(req.url);
  const accessPointId = allowed.assignedGateId ?? url.searchParams.get("gate") ?? undefined;
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam) : undefined;

  const data = await getDoorDownload({ sessionId, accessPointId, since });
  return data ? json(data) : json({ error: "Función no encontrada." }, 404);
}
