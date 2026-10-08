import { authenticateDevice } from "@ticketera/db";

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
