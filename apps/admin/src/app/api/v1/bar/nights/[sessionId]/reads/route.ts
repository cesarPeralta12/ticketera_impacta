import { z } from "zod";
import { canUseBar, submitBarReads } from "@ticketera/db";
import { MAX_BODY, json, mobileStaff, passwordChangeRequired, readJson } from "@/lib/mobile-auth";

const bodySchema = z.object({
  reads: z
    .array(
      z.object({
        /** Id que genera la app por lectura: reenviar la misma no la duplica. */
        id: z.string().min(8).max(64),
        code: z.string().min(1).max(500),
        /** Hora del teléfono en que se leyó (el servidor la recorta si está en el futuro o es muy vieja). */
        readAt: z.iso.datetime(),
        note: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * Sube las lecturas de QR de consumo (en vivo o un lote hecho sin conexión). Cada una vuelve con su resultado:
 * REDEEMED (la marcó este teléfono), ALREADY_REDEEMED (ya estaba leída: trae quién y cuándo), CANCELLED o REJECTED.
 */
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const staff = await mobileStaff(req);
  if (!staff) return json({ error: "Sesión vencida." }, 401);
  if (staff.mustChangePassword) return passwordChangeRequired();
  if (!canUseBar(staff)) return json({ error: "Tu cuenta no atiende la barra." }, 403);
  const raw = await readJson(req, MAX_BODY.scans);
  if (!raw.ok) return raw.response;
  const parsed = bodySchema.safeParse(raw.data);
  if (!parsed.success) return json({ error: "Datos inválidos." }, 400);
  const results = await submitBarReads(staff, (await params).sessionId, parsed.data.reads);
  return results ? json({ results }) : json({ error: "Noche no disponible para tu cuenta." }, 403);
}
