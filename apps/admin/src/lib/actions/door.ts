"use server";

import { revalidatePath } from "next/cache";
import { prisma, revokeDevice } from "@ticketera/db";
import { accountOrganizationId, organizationScope } from "@/lib/account-scope";
import { logAudit } from "@/lib/audit";
import type { FormState } from "@/lib/forms";
import { ROLES, requireEditor } from "@/lib/session";

/** Portero de esta organización (solo el rol OPERATOR usa asignaciones). */
async function findOperator(userId: string, organizationId: string) {
  return prisma.staffUser.findFirst({
    where: { id: userId, memberships: { some: { organizationId, role: "OPERATOR" } } },
    select: { id: true },
  });
}

/** Asigna una función (y opcionalmente una puerta) a un portero: es lo que verá y podrá descargar en la app. */
export async function assignDoorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor(ROLES.users);
  // La organización del portero (iPass asigna a los porteros de cualquier boliche u organizador sin "entrar" en él).
  const organizationId = await accountOrganizationId(staff, String(formData.get("userId")));
  const operator = organizationId ? await findOperator(String(formData.get("userId")), organizationId) : null;
  if (!operator || !organizationId) return { error: "Portero no encontrado." };

  const session = await prisma.eventSession.findFirst({
    where: { id: String(formData.get("sessionId")), event: { organizationId } },
    select: { id: true, venueId: true },
  });
  if (!session) return { error: "Elige una función." };

  // Cada cuenta de portero trabaja una sola puerta: la app descarga sus datos sin preguntar.
  const gateId = String(formData.get("accessPointId") ?? "");
  const gate = gateId ? await prisma.accessPoint.findFirst({ where: { id: gateId, venueId: session.venueId } }) : null;
  if (!gate) return { error: "Elige la puerta de esta cuenta (debe ser una puerta del recinto de la función)." };

  const where = { userId_sessionId: { userId: operator.id, sessionId: session.id } };
  const previous = await prisma.doorAssignment.findUnique({ where, select: { accessPoint: { select: { id: true, name: true } } } });
  await prisma.doorAssignment.upsert({
    where,
    create: { userId: operator.id, sessionId: session.id, accessPointId: gate.id },
    update: { accessPointId: gate.id },
  });
  revalidatePath(`/usuarios/${operator.id}`);
  // Una segunda puerta en la misma función reemplaza a la primera: se avisa, para no creer que cubre las dos.
  const before = previous?.accessPoint;
  return {
    ok: true,
    message:
      before && before.id !== gate.id
        ? `Ahora controla ${gate.name} (antes: ${before.name}). Cada portero trabaja una sola puerta por función: para la otra, asigna a otro portero.`
        : `Asignado a ${gate.name}.`,
  };
}

export async function unassignDoorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor(ROLES.users);
  const assignment = await prisma.doorAssignment.findFirst({
    where: { id: String(formData.get("assignmentId")), session: { event: organizationScope(staff) } },
  });
  if (!assignment) return { error: "Asignación no encontrada." };
  await prisma.doorAssignment.delete({ where: { id: assignment.id } });
  revalidatePath(`/usuarios/${assignment.userId}`);
  return { ok: true };
}

/** Cierra la sesión de un teléfono: pierde el acceso en su siguiente llamada (por ejemplo, si lo perdieron). */
export async function revokeDeviceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor(ROLES.users);
  const deviceTokenId = String(formData.get("deviceTokenId"));
  const device = await prisma.deviceToken.findFirst({
    where: { id: deviceTokenId, revokedAt: null, user: { memberships: { some: organizationScope(staff) } } },
    select: { userId: true, deviceName: true },
  });
  const deviceOrganizationId = device ? await accountOrganizationId(staff, device.userId) : null;
  if (deviceOrganizationId) await revokeDevice(deviceTokenId, deviceOrganizationId);
  if (device && deviceOrganizationId) {
    await logAudit({
      actorType: "staff",
      actorId: staff.id,
      organizationId: deviceOrganizationId,
      action: "device.revoked",
      entity: "StaffUser",
      entityId: device.userId,
      data: { deviceName: device.deviceName },
    });
  }
  revalidatePath("/usuarios", "layout");
  return { ok: true };
}
