import { z } from "zod";
import { LIMITS, hit, isLimited, recordHit, startDeviceSession } from "@ticketera/db";
import { json } from "@/lib/mobile-auth";

const bodySchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
  deviceId: z.string().min(4).max(64),
  deviceName: z.string().max(80).default("Teléfono"),
});

/** Login de la app móvil de puerta: devuelve un token propio del teléfono (revocable desde el panel). */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Datos inválidos." }, 400);
  // Mismos límites que el panel: por IP y por cuenta (solo contraseñas incorrectas).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida";
  const account = parsed.data.email.toLowerCase();
  if (!(await hit(`login:ip:${ip}`, LIMITS.loginByIp)) || (await isLimited(`login:fail:${account}`, LIMITS.loginFailuresByAccount))) {
    return json({ error: "Demasiados intentos. Espera unos minutos y vuelve a intentar." }, 429);
  }
  const result = await startDeviceSession(parsed.data);
  if ("error" in result) {
    return result.error === "ROLE"
      ? json({ error: "Esta cuenta no tiene acceso a la app de puerta." }, 403)
      : (await recordHit(`login:fail:${account}`), json({ error: "Email o contraseña incorrectos." }, 401));
  }
  return json(result);
}
