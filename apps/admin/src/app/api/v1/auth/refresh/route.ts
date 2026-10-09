import { z } from "zod";
import { LIMITS, hit, refreshDeviceSession } from "@ticketera/db";
import { json, mobileContext, readJson } from "@/lib/mobile-auth";

const bodySchema = z.object({ refreshToken: z.string().min(20).max(200) });

/**
 * Renueva la sesión del teléfono: cambia el token de renovación por un par nuevo (el anterior deja de
 * valer). 401 = hay que iniciar sesión de nuevo; 409 = reintentar (dos renovaciones a la vez).
 */
export async function POST(req: Request) {
  const raw = await readJson(req);
  if (!raw.ok) return raw.response;
  const parsed = bodySchema.safeParse(raw.data);
  if (!parsed.success) return json({ error: "Datos inválidos." }, 400);
  const context = mobileContext(req);
  if (!(await hit(`refresh:ip:${context.ip}`, LIMITS.refreshByIp))) return json({ error: "Demasiados intentos." }, 429);

  const result = await refreshDeviceSession(parsed.data.refreshToken, context);
  if (!result.ok) {
    if (result.reason === "BUSY") return json({ error: "Intenta de nuevo." }, 409);
    return json({ error: "Sesión vencida. Inicia sesión de nuevo." }, 401);
  }
  return json({ token: result.token, refreshToken: result.refreshToken, expiresAt: result.expiresAt.toISOString() });
}
