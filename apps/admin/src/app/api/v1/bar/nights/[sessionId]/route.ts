import { canUseBar, getBarDownload } from "@ticketera/db";
import { json, mobileStaff, passwordChangeRequired } from "@/lib/mobile-auth";

/** Descarga de una noche para leer los QR de consumo sin internet: todos los vales con su estado. */
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const staff = await mobileStaff(req);
  if (!staff) return json({ error: "Sesión vencida." }, 401);
  if (staff.mustChangePassword) return passwordChangeRequired();
  if (!canUseBar(staff)) return json({ error: "Tu cuenta no atiende la barra." }, 403);
  const data = await getBarDownload(staff, (await params).sessionId);
  return data ? json(data) : json({ error: "Noche no disponible para tu cuenta." }, 403);
}
