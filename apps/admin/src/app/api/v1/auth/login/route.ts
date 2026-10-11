import { z } from "zod";
import { LIMITS, hit, isLimited, recordHit, recordLogin, recordLoginFailure, startDeviceSession } from "@ticketera/db";
import { json, mobileContext, readJson } from "@/lib/mobile-auth";

const bodySchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
  deviceId: z.string().min(4).max(64),
  deviceName: z.string().max(80).default("Teléfono"),
});

/**
 * Login de la app móvil de puerta: devuelve un token de acceso corto y un token de renovación propios del
 * teléfono (revocables desde el panel).
 */
export async function POST(req: Request) {
  const raw = await readJson(req);
  if (!raw.ok) return raw.response;
  const parsed = bodySchema.safeParse(raw.data);
  if (!parsed.success) return json({ error: "Datos inválidos." }, 400);
  const context = mobileContext(req);
  const audit = { ...context, deviceId: parsed.data.deviceId, deviceName: parsed.data.deviceName };
  // Mismos límites que el panel: por IP y por cuenta (solo contraseñas incorrectas).
  const account = parsed.data.email.toLowerCase();
  if (!(await hit(`login:ip:${context.ip}`, LIMITS.loginByIp)) || (await isLimited(`login:fail:${account}`, LIMITS.loginFailuresByAccount))) {
    await recordLoginFailure({ kind: "staff", email: account, reason: "BLOCKED", context: audit });
    return json({ error: "Demasiados intentos. Espera unos minutos y vuelve a intentar." }, 429);
  }
  const result = await startDeviceSession({ ...parsed.data, context });
  if ("error" in result) {
    await recordLoginFailure({ kind: "staff", email: account, reason: result.error, context: audit });
    return result.error === "ROLE"
      ? json({ error: "Esta cuenta no tiene acceso a la app de puerta." }, 403)
      : (await recordHit(`login:fail:${account}`), json({ error: "Email o contraseña incorrectos." }, 401));
  }
  await recordLogin({ kind: "staff", userId: result.staff.id, context: audit });
  return json({ token: result.token, refreshToken: result.refreshToken, expiresAt: result.expiresAt.toISOString(), staff: result.staff });
}
