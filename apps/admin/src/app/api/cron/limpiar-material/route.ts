import { timingSafeEqual } from "node:crypto";
import { purgeExpiredPromoAssets } from "@ticketera/db";

/**
 * Borra el material promocional de los eventos que terminaron hace más de 30 días. Lo llama la tarea agendada del
 * hosting (una vez al día) con `Authorization: Bearer <CRON_SECRET>`. Sin CRON_SECRET configurado no hace nada.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  const ok = Boolean(secret) && given.length === secret!.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret!));
  if (!ok) return Response.json({ error: "No autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const deleted = await purgeExpiredPromoAssets();
  return Response.json({ deleted }, { headers: { "Cache-Control": "no-store" } });
}
