"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH, StaffRole, createStaffUser, prisma } from "@ticketera/db";
import { formObject, zodErrors, type FormState } from "@/lib/forms";
import { ROLES, requireStaff } from "@/lib/session";

const staffSchema = z.object({
  name: z.string({ error: "Ingresa el nombre." }).min(3).max(120),
  email: z.string({ error: "Ingresa el email." }).toLowerCase().pipe(z.email("Email inválido.")),
  role: z.enum(Object.values(StaffRole) as [StaffRole, ...StaffRole[]]),
  password: z
    .string({ error: "Ingresa una contraseña temporal." })
    .min(MIN_PASSWORD_LENGTH, `Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`),
  clientId: z.string().optional(),
});

/** Reemplaza el registro público de organizadores del prototipo: las cuentas las crea el staff. */
export async function createStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.users);
  const parsed = staffSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  if (parsed.data.role === "OWNER" && staff.role !== "OWNER") {
    return { fieldErrors: { role: "Solo un dueño puede crear otro dueño." } };
  }
  // Solo la cuenta de un cliente queda atada a un cliente: es lo que limita qué eventos ve.
  let clientId: string | undefined;
  if (parsed.data.role === "CLIENT") {
    const client = parsed.data.clientId
      ? await prisma.client.findFirst({ where: { id: parsed.data.clientId, organizationId: staff.organization.id } })
      : null;
    if (!client) return { fieldErrors: { clientId: "Elige el cliente al que pertenece esta cuenta." } };
    clientId = client.id;
  }

  const created = await createStaffUser({ organizationId: staff.organization.id, ...parsed.data, clientId });
  if (!created) return { fieldErrors: { email: "Ya existe una cuenta con ese email." } };
  await prisma.auditLog.create({
    data: { actorType: "staff", actorId: staff.id, action: "staff.create", entity: "StaffUser", entityId: created.id, data: { role: parsed.data.role } },
  });
  revalidatePath("/usuarios");
  return { ok: true };
}

/** Desactivar corta el acceso de inmediato: requireStaff() lo verifica en cada request. */
export async function toggleStaffActiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.users);
  const userId = String(formData.get("userId"));
  if (userId === staff.id) return { error: "No puedes desactivar tu propia cuenta." };

  const target = await prisma.staffUser.findFirst({
    where: { id: userId, memberships: { some: { organizationId: staff.organization.id } } },
    include: { memberships: { where: { organizationId: staff.organization.id } } },
  });
  if (!target) return { error: "Usuario no encontrado." };
  if (target.memberships[0]?.role === "OWNER" && staff.role !== "OWNER") {
    return { error: "Solo un dueño puede desactivar a otro dueño." };
  }

  await prisma.staffUser.update({ where: { id: target.id }, data: { active: !target.active } });
  await prisma.auditLog.create({
    data: {
      actorType: "staff",
      actorId: staff.id,
      action: target.active ? "staff.deactivate" : "staff.activate",
      entity: "StaffUser",
      entityId: target.id,
    },
  });
  revalidatePath("/usuarios");
  return { ok: true };
}
