"use server";

import { revalidatePath } from "next/cache";
import { prisma, revokeDevice } from "@ticketera/db";
import { logAudit } from "@/lib/audit";
import type { FormState } from "@/lib/forms";
import { ROLES, requireStaff } from "@/lib/session";

/** Portero de esta organización (solo el rol OPERATOR usa asignaciones). */
async function findOperator(userId: string, organizationId: string) {
  return prisma.staffUser.findFirst({
    where: { id: userId, memberships: { some: { organizationId, role: "OPERATOR" } } },
    select: { id: true },
  });
}

/** Asigna una función (y opcionalmente una puerta) a un portero: es lo que verá y podrá descargar en la app. */
export async function assignDoorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.users);
  const operator = await findOperator(String(formData.get("userId")), staff.organization.id);
  if (!operator) return { error: "Portero no encontrado." };

  const session = await prisma.eventSession.findFirst({
    where: { id: String(formData.get("sessionId")), event: { organizationId: staff.organization.id } },
    select: { id: true, venueId: true },
  });
  if (!session) return { error: "Elige una función." };

  // Cada cuenta de portero trabaja una sola puerta: la app descarga sus datos sin preguntar.
  const gateId = String(formData.get("accessPointId") ?? "");
  const gate = gateId ? await prisma.accessPoint.findFirst({ where: { id: gateId, venueId: session.venueId } }) : null;
  if (!gate) return { error: "Elige la puerta de esta cuenta (debe ser una puerta del recinto de la función)." };

  await prisma.doorAssignment.upsert({
    where: { userId_sessionId: { userId: operator.id, sessionId: session.id } },
    create: { userId: operator.id, sessionId: session.id, accessPointId: gate.id },
    update: { accessPointId: gate.id },
  });
  revalidatePath(`/usuarios/${operator.id}`);
  return { ok: true };
}

export async function unassignDoorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.users);
  const assignment = await prisma.doorAssignment.findFirst({
    where: { id: String(formData.get("assignmentId")), session: { event: { organizationId: staff.organization.id } } },
  });
  if (!assignment) return { error: "Asignación no encontrada." };
  await prisma.doorAssignment.delete({ where: { id: assignment.id } });
  revalidatePath(`/usuarios/${assignment.userId}`);
  return { ok: true };
}

/** Cierra la sesión de un teléfono: pierde el acceso en su siguiente llamada (por ejemplo, si lo perdieron). */
export async function revokeDeviceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.users);
  const deviceTokenId = String(formData.get("deviceTokenId"));
  const device = await prisma.deviceToken.findFirst({
    where: { id: deviceTokenId, revokedAt: null, user: { memberships: { some: { organizationId: staff.organization.id } } } },
    select: { userId: true, deviceName: true },
  });
  await revokeDevice(deviceTokenId, staff.organization.id);
  if (device) {
    await logAudit({
      actorType: "staff",
      actorId: staff.id,
      organizationId: staff.organization.id,
      action: "device.revoked",
      entity: "StaffUser",
      entityId: device.userId,
      data: { deviceName: device.deviceName },
    });
  }
  revalidatePath("/usuarios", "layout");
  return { ok: true };
}
