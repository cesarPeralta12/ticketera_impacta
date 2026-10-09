"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH, StaffRole, createStaffUser, prisma, revokeAllSessions } from "@ticketera/db";
import { formObject, zodErrors, type FormState } from "@/lib/forms";
import { ROLES, requirePlatform, requireStaff } from "@/lib/session";

const staffSchema = z.object({
  name: z.string({ error: "Ingresa el nombre." }).min(3).max(120),
  email: z.string({ error: "Ingresa el email." }).toLowerCase().pipe(z.email("Email inválido.")),
  role: z.enum(Object.values(StaffRole) as [StaffRole, ...StaffRole[]]),
  password: z
    .string({ error: "Ingresa una contraseña temporal." })
    .min(MIN_PASSWORD_LENGTH, `Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`),
  clientId: z.string().optional(),
});

/** Roles que se pueden dar en la cuenta de un organizador: ahí no hay dueños ni clientes. */
const ORGANIZER_ROLES: StaffRole[] = ["ADMIN", "OPERATOR", "CASHIER"];

/**
 * Solo IMPACTA crea cuentas: las suyas, o las de un organizador cuando entró en él. La
 * contraseña es temporal: la persona la cambia al entrar por primera vez.
 */
export async function createStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePlatform();
  const parsed = staffSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const organization = staff.organization;

  if (!organization.isPlatform && !ORGANIZER_ROLES.includes(parsed.data.role)) {
    return { fieldErrors: { role: "Para un organizador: administrador, operador de puerta o cajero." } };
  }
  if (parsed.data.role === "OWNER" && staff.role !== "OWNER") {
    return { fieldErrors: { role: "Solo un dueño puede crear otro dueño." } };
  }
  // Solo la cuenta de un cliente queda atada a un cliente: es lo que limita qué eventos ve.
  let clientId: string | undefined;
  if (parsed.data.role === "CLIENT") {
    const client = parsed.data.clientId
      ? await prisma.client.findFirst({ where: { id: parsed.data.clientId, organizationId: organization.id } })
      : null;
    if (!client) return { fieldErrors: { clientId: "Elige el cliente al que pertenece esta cuenta." } };
    clientId = client.id;
  }

  const created = await createStaffUser({
    organizationId: organization.id,
    ...parsed.data,
    clientId,
    mustChangePassword: true,
  });
  if (!created) return { fieldErrors: { email: "Ya existe una cuenta con ese email." } };
  await prisma.auditLog.create({
    data: {
      actorType: "staff",
      actorId: staff.id,
      action: "staff.create",
      entity: "StaffUser",
      entityId: created.id,
      data: { role: parsed.data.role, organizationId: organization.id },
    },
  });
  revalidatePath("/usuarios");
  return { ok: true };
}

/** Desactivar corta el acceso de inmediato: requireStaff() lo verifica en cada request. */
export async function toggleStaffActiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePlatform();
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

/**
 * Cierra TODAS las sesiones de una cuenta (navegadores y teléfonos): para cuando se perdió un aparato o se
 * sospecha de la cuenta. La persona tiene que volver a iniciar sesión.
 */
export async function revokeUserSessionsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.users);
  const target = await prisma.staffUser.findFirst({
    where: { id: String(formData.get("userId")), memberships: { some: { organizationId: staff.organization.id } } },
    include: { memberships: { where: { organizationId: staff.organization.id } } },
  });
  if (!target) return { error: "Usuario no encontrado." };
  if (target.memberships[0]?.role === "OWNER" && staff.role !== "OWNER") return { error: "Solo un dueño puede cerrar las sesiones de otro dueño." };
  const { devices } = await revokeAllSessions("staff", target.id);
  await prisma.auditLog.create({
    data: { actorType: "staff", actorId: staff.id, action: "auth.sessions_revoked", entity: "StaffUser", entityId: target.id, data: { by: "admin", devices } },
  });
  revalidatePath("/usuarios", "layout");
  return { ok: true };
}
