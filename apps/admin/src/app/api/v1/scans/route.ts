import { z } from "zod";
import { canControlSession, prisma, recordAuditSafely, scanTicket } from "@ticketera/db";
import { MAX_BODY, json, mobileContext, mobileStaff, passwordChangeRequired, readJson } from "@/lib/mobile-auth";

const REJECTIONS = [
  "ALREADY_USED",
  "NOT_FOUND",
  "CANCELLED",
  "WRONG_SESSION",
  "WRONG_GATE",
  "INVALID",
  "METHOD_NOT_ALLOWED",
  "QR_EXPIRED",
  "STATIC_NOT_ALLOWED",
] as const;

const bodySchema = z.object({
  sessionId: z.string().min(1),
  accessPointId: z.string().optional(),
  scans: z
    .array(
      z.object({
        id: z.string().min(8).max(64),
        raw: z.string().min(1).max(500),
        method: z.enum(["QR", "BARCODE", "NFC", "MANUAL"]),
        scannedAt: z.iso.datetime(),
        /** Lectura hecha sin conexión (validada contra la lista descargada). */
        offline: z.boolean(),
        accessPointId: z.string().optional(),
        /** Rechazo decidido por el teléfono: se registra tal cual, la persona no entró. */
        offlineResult: z.enum(REJECTIONS).optional(),
      }),
    )
    .min(1)
    .max(500),
});

/** Hora de una lectura offline: la del teléfono, pero nunca en el futuro ni de hace más de una semana. */
function clampScanTime(iso: string, now: Date) {
  const at = new Date(iso);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  return at > now ? now : at < weekAgo ? weekAgo : at;
}

/**
 * Sube lecturas de la app móvil (en vivo o un lote hecho sin conexión). Cada lectura trae su id:
 * reenviar un lote no duplica nada. Devuelve el resultado oficial de cada una.
 */
export async function POST(req: Request) {
  const staff = await mobileStaff(req);
  if (!staff) return json({ error: "Sesión vencida." }, 401);
  if (staff.mustChangePassword) return passwordChangeRequired();
  const raw = await readJson(req, MAX_BODY.scans);
  if (!raw.ok) return raw.response;
  const parsed = bodySchema.safeParse(raw.data);
  if (!parsed.success) return json({ error: "Datos inválidos." }, 400);
  const body = parsed.data;

  const allowed = await canControlSession(staff, body.sessionId);
  if (!allowed) return json({ error: "Función no disponible para tu cuenta." }, 403);

  const gates = new Set(
    (await prisma.accessPoint.findMany({ where: { venueId: allowed.venueId }, select: { id: true } })).map((g) => g.id),
  );
  const gateFor = (id: string | undefined) => {
    const chosen = allowed.assignedGateId ?? id;
    return chosen && gates.has(chosen) ? chosen : undefined;
  };

  const now = new Date();
  const results = [];
  const notes: Record<string, number> = {};
  // En orden: si dos lecturas del lote son de la misma entrada, la primera es la que entró.
  for (const scan of body.scans.toSorted((a, b) => a.scannedAt.localeCompare(b.scannedAt))) {
    const outcome = await scanTicket({
      sessionId: body.sessionId,
      accessPointId: gateFor(scan.accessPointId ?? body.accessPointId),
      operatorId: staff.id,
      deviceId: staff.deviceId,
      raw: scan.raw,
      method: scan.method,
      clientScanId: scan.id,
      offline: scan.offline,
      scannedAt: scan.offline ? clampScanTime(scan.scannedAt, now) : undefined,
      offlineResult: scan.offline ? scan.offlineResult : undefined,
    });
    if (outcome.proofNote) notes[outcome.proofNote] = (notes[outcome.proofNote] ?? 0) + 1;
    results.push({
      id: scan.id,
      ...outcome,
      previousEntry: outcome.previousEntry
        ? { at: outcome.previousEntry.at.toISOString(), accessPoint: outcome.previousEntry.accessPoint }
        : null,
    });
  }
  // Un solo evento por lote (no uno por lectura): cuántas entraron, cuántas se rechazaron y desde qué teléfono.
  const accepted = results.filter((r) => r.result === "ACCEPTED").length;
  await recordAuditSafely({
    actorType: "staff",
    actorId: staff.id,
    action: "scan.batch",
    entity: "EventSession",
    entityId: body.sessionId,
    // QR dinámico: capturas viejas rechazadas y pruebas sospechosas de lecturas sin conexión.
    severity: notes.BAD_PROOF ? "warn" : "info",
    data: {
      total: results.length,
      accepted,
      rejected: results.length - accepted,
      offline: body.scans.filter((s) => s.offline).length,
      expired: results.filter((r) => r.result === "QR_EXPIRED").length,
      ...notes,
    },
    context: { ...mobileContext(req), deviceId: staff.deviceId, deviceName: staff.deviceName },
  });
  return json({ results });
}
