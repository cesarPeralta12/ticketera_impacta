import { z } from "zod";
import { prisma, scanTicket } from "@ticketera/db";
import { doorSession } from "@/lib/door";
import { ROLES, can, currentStaff } from "@/lib/session";

const REJECTIONS = ["ALREADY_USED", "NOT_FOUND", "CANCELLED", "WRONG_SESSION", "WRONG_GATE", "INVALID"] as const;

const bodySchema = z.object({
  sessionId: z.string().min(1),
  accessPointId: z.string().optional(),
  deviceId: z.string().max(64).optional(),
  scans: z
    .array(
      z.object({
        id: z.string().min(8).max(64),
        raw: z.string().min(1).max(500),
        scannedAt: z.iso.datetime(),
        offline: z.boolean(),
        /** Puerta en la que se hizo la lectura (el operador puede cambiarla estando offline). */
        accessPointId: z.string().optional(),
        /** Rechazo que decidió el celular sin conexión (la persona no entró). */
        offlineResult: z.enum(REJECTIONS).optional(),
      }),
    )
    .min(1)
    .max(500),
});

/** Hora de una lectura offline: la del celular, pero nunca en el futuro ni de hace más de una semana. */
function clampScanTime(iso: string, now: Date) {
  const at = new Date(iso);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  return at > now ? now : at < weekAgo ? weekAgo : at;
}

/**
 * Valida lecturas de la app de puerta: una en vivo o un lote de lecturas hechas sin conexión.
 * Cada lectura trae su id, así que reenviar un lote no duplica nada.
 */
export async function POST(req: Request) {
  const staff = await currentStaff();
  if (!staff || !can(staff, ROLES.access)) return Response.json({ error: "Sin permiso." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Datos inválidos." }, { status: 400 });
  const body = parsed.data;

  const session = await doorSession(staff, body.sessionId);
  if (!session) return Response.json({ error: "Función no encontrada." }, { status: 404 });
  // Solo puertas del recinto de la función.
  const gates = new Set(
    (await prisma.accessPoint.findMany({ where: { venueId: session.venueId }, select: { id: true } })).map((g) => g.id),
  );
  const gateFor = (id: string | undefined) => (id && gates.has(id) ? id : undefined);

  const now = new Date();
  const results = [];
  // En orden: si dos lecturas del lote son de la misma entrada, la primera es la que entró.
  for (const scan of body.scans.toSorted((a, b) => a.scannedAt.localeCompare(b.scannedAt))) {
    const outcome = await scanTicket({
      sessionId: session.id,
      accessPointId: gateFor(scan.accessPointId ?? body.accessPointId),
      operatorId: staff.id,
      deviceId: body.deviceId,
      raw: scan.raw,
      clientScanId: scan.id,
      offline: scan.offline,
      scannedAt: scan.offline ? clampScanTime(scan.scannedAt, now) : undefined,
      offlineResult: scan.offline ? scan.offlineResult : undefined,
    });
    results.push({
      id: scan.id,
      ...outcome,
      previousEntry: outcome.previousEntry
        ? { at: outcome.previousEntry.at.toISOString(), accessPoint: outcome.previousEntry.accessPoint }
        : null,
    });
  }
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
