import { authenticateDevice } from "@ticketera/db";
import { ipFromHeaders } from "./client-ip";

/** Respuesta JSON sin caché (los datos de puerta cambian y llevan información personal). */
export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Usuario de la app móvil a partir de `Authorization: Bearer <token>`, o null. */
export async function mobileStaff(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ? authenticateDevice(match[1]) : null;
}

/** Respuesta para una cuenta con contraseña temporal: debe cambiarla antes de usar la app. */
export const passwordChangeRequired = () =>
  json({ error: "Cambia tu contraseña temporal para continuar.", code: "PASSWORD_CHANGE_REQUIRED" }, 403);

/** Tamaños máximos de cuerpo: un login cabe en pocos bytes; un lote de lecturas es lo único grande. */
export const MAX_BODY = { small: 8 * 1024, scans: 512 * 1024 };

/**
 * Lee el cuerpo JSON con tope de tamaño (no confía en Content-Length: corta la lectura al pasarse), para que
 * nadie agote memoria enviando cuerpos enormes.
 */
export async function readJson(req: Request, maxBytes = MAX_BODY.small): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  const tooLarge = () => ({ ok: false as const, response: json({ error: "Solicitud demasiado grande." }, 413) });
  if (declared > maxBytes) return tooLarge();
  const reader = req.body?.getReader();
  if (!reader) return { ok: false, response: json({ error: "Datos inválidos." }, 400) };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return tooLarge();
    }
    chunks.push(value);
  }
  try {
    return { ok: true, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, response: json({ error: "Datos inválidos." }, 400) };
  }
}

/** IP y datos del teléfono para el registro de seguridad. */
export function mobileContext(req: Request) {
  return {
    ip: ipFromHeaders(req.headers),
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? undefined,
    appVersion: req.headers.get("x-app-version")?.slice(0, 20) ?? undefined,
    platform: req.headers.get("x-app-platform")?.slice(0, 20) ?? undefined,
  };
}
