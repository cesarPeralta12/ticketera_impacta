import { z } from "zod";
import { MIN_PASSWORD_LENGTH, changeStaffPassword } from "@ticketera/db";
import { json, mobileStaff, readJson } from "@/lib/mobile-auth";

const bodySchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(MIN_PASSWORD_LENGTH).max(200) });

/** Cambia la contraseña de la cuenta de portero (obligatorio la primera vez, con la contraseña temporal). */
export async function POST(req: Request) {
  const staff = await mobileStaff(req);
  if (!staff) return json({ error: "Sesión vencida." }, 401);
  const raw = await readJson(req);
  if (!raw.ok) return raw.response;
  const parsed = bodySchema.safeParse(raw.data);
  if (!parsed.success) return json({ error: `La contraseña nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }, 400);
  if (parsed.data.current === parsed.data.next) return json({ error: "La contraseña nueva debe ser distinta." }, 400);
  if (!(await changeStaffPassword(staff.id, parsed.data.current, parsed.data.next, { keepDeviceTokenId: staff.deviceTokenId }))) {
    return json({ error: "La contraseña actual no es correcta." }, 400);
  }
  return json({ ok: true });
}
