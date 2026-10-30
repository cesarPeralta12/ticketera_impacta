import { z } from "zod";
import { prisma, recordAuditSafely } from "@ticketera/db";
import { json, mobileContext, mobileStaff, passwordChangeRequired, readJson } from "@/lib/mobile-auth";

const bodySchema = z.object({
  sessionId: z.string().min(1).max(40),
  code: z.string().regex(/^[2-9A-HJKMNP-Z]{10}$/),
  locked: z.boolean().default(false),
});

/**
 * Deja constancia de que un administrador grabó una pulsera NFC con el código de una entrada. Solo dueños y
 * administradores; la entrada tiene que ser de una función de su organización.
 */
export async function POST(req: Request) {
  const staff = await mobileStaff(req);
  if (!staff) return json({ error: "Sesión vencida." }, 401);
  if (staff.mustChangePassword) return passwordChangeRequired();
  if (staff.role !== "OWNER" && staff.role !== "ADMIN") return json({ error: "Solo un administrador puede grabar pulseras." }, 403);

  const raw = await readJson(req);
  if (!raw.ok) return raw.response;
  const parsed = bodySchema.safeParse(raw.data);
  if (!parsed.success) return json({ error: "Datos inválidos." }, 400);

  const ticket = await prisma.ticket.findFirst({
    where: { code: parsed.data.code, sessionId: parsed.data.sessionId, session: { event: { organizationId: staff.organizationId } } },
    select: { id: true, ticketType: { select: { accessMethods: true } } },
  });
  if (!ticket) return json({ error: "Entrada no encontrada en tu organización." }, 404);

  await recordAuditSafely({
    actorType: "staff",
    actorId: staff.id,
    organizationId: staff.organizationId,
    action: "nfc.written",
    entity: "Ticket",
    entityId: ticket.id,
    data: { code: parsed.data.code, locked: parsed.data.locked, nfcEnabled: ticket.ticketType.accessMethods.includes("NFC") },
    context: { ...mobileContext(req), deviceId: staff.deviceId, deviceName: staff.deviceName },
  });
  return json({ ok: true });
}
