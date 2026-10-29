import { canUseBar, getBarNights } from "@ticketera/db";
import { json, mobileStaff, passwordChangeRequired } from "@/lib/mobile-auth";

/** Noches con consumo incluido que esta cuenta puede atender en la barra (con cuántos QR de consumo ya se leyeron). */
export async function GET(req: Request) {
  const staff = await mobileStaff(req);
  if (!staff) return json({ error: "Sesión vencida." }, 401);
  if (staff.mustChangePassword) return passwordChangeRequired();
  if (!canUseBar(staff)) return json({ error: "Tu cuenta no atiende la barra." }, 403);
  return json({ staff: { name: staff.name, role: staff.role }, nights: await getBarNights(staff) });
}
