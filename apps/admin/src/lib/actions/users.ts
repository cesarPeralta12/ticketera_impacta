"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH, StaffRole, createStaffUser, prisma, revokeAllSessions } from "@ticketera/db";
import { formObject, zodErrors, type FormState } from "@/lib/forms";
import { STAFF_ROLES, accountOrganizationId, canManageRole } from "@/lib/account-scope";
import { ROLES, requireAccountAdmin, requireEditor } from "@/lib/session";
import { logAudit } from "@/lib/audit";

const staffSchema = z.object({
  name: z.string({ error: "Ingresa el nombre." }).min(3).max(120),
  email: z.string({ error: "Ingresa el email." }).toLowerCase().pipe(z.email("Email inválido.")),
  role: z.enum(Object.values(StaffRole) as [StaffRole, ...StaffRole[]]),
  password: z
    .string({ error: "Ingresa una contraseña temporal." })
    .min(MIN_PASSWORD_LENGTH, `Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`),
  clientId: z.string().optional(),
  /** Organización de la cuenta: solo iPass elige; un organizador crea siempre en la suya. */
  organizationId: z.string().optional(),
});

/** Roles que se pueden dar en la cuenta de un organizador: ahí no hay dueños ni clientes. */
const ORGANIZER_ROLES: StaffRole[] = ["ADMIN", "OPERATOR", "CASHIER", "PROMOTER", "BAR"];

/**
 * iPass crea cuentas para sí o para cualquier organizador (sin "entrar" en él); un organizador con administración
 * propia crea las de su personal. La contraseña es temporal: la persona la cambia al entrar por primera vez.
 */
export async function createStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireAccountAdmin();
  const parsed = staffSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const requested = parsed.data.organizationId;
  const organization = staff.platform && requested && requested !== staff.organization.id ? await prisma.organization.findUnique({ where: { id: requested } }) : staff.organization;
  if (!organization) return { fieldErrors: { organizationId: "Organizador no encontrado." } };
  if (!organization.isPlatform && organization.status !== "ACTIVE") return { fieldErrors: { organizationId: "Ese organizador está suspendido." } };

  if (!organization.isPlatform && !ORGANIZER_ROLES.includes(parsed.data.role)) {
    return { fieldErrors: { role: "Para un organizador: administrador, operador de puerta, cajero, barra o promotor." } };
  }
  // Un organizador con administración propia solo crea a su personal: los administradores de su cuenta los da iPass.
  if (!staff.platform && !STAFF_ROLES.includes(parsed.data.role)) {
    return { fieldErrors: { role: "Puedes crear portero, cajero, barra o promotor. Los administradores los crea iPass." } };
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

  // Los cajeros nuevos y los promotores venden solo lo que se les asigne; los cajeros que ya existían siguen con todo.
  const assignedOnly = parsed.data.role === "CASHIER" || parsed.data.role === "PROMOTER" || parsed.data.role === "BAR";
  const created = await createStaffUser({
    organizationId: organization.id,
    ...parsed.data,
    clientId,
    mustChangePassword: true,
    salesScope: assignedOnly ? "ASSIGNED" : "ALL",
  });
  if (!created) return { fieldErrors: { email: "Ya existe una cuenta con ese email." } };
  await logAudit({
      actorType: "staff",
      actorId: staff.id,
      action: "staff.create",
      entity: "StaffUser",
      entityId: created.id,
      data: { role: parsed.data.role, organizationId: organization.id },
    });
  revalidatePath("/usuarios", "layout");
  if (parsed.data.role === "CASHIER") return { ok: true, message: "Cuenta creada. Ahora toca «Qué puede vender» en su fila para asignarle eventos y funciones." };
  if (parsed.data.role === "BAR") return { ok: true, message: "Cuenta creada. Ahora toca «Noches que atiende» en su fila para asignarle las noches." };
  if (parsed.data.role === "PROMOTER") return { ok: true, message: "Cuenta creada. Asígnale eventos y comisión en Promotores." };
  return { ok: true };
}

/** Desactivar corta el acceso de inmediato: requireStaff() lo verifica en cada request. */
export async function toggleStaffActiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireAccountAdmin();
  const userId = String(formData.get("userId"));
  if (userId === staff.id) return { error: "No puedes desactivar tu propia cuenta." };

  const organizationId = await accountOrganizationId(staff, userId);
  const target = organizationId
    ? await prisma.staffUser.findFirst({ where: { id: userId, memberships: { some: { organizationId } } }, include: { memberships: { where: { organizationId } } } })
    : null;
  if (!target) return { error: "Usuario no encontrado." };
  const role = target.memberships[0]?.role;
  if (role && !canManageRole(staff, role)) return { error: "Esa cuenta la maneja iPass." };
  if (role === "OWNER" && staff.role !== "OWNER") {
    return { error: "Solo un dueño puede desactivar a otro dueño." };
  }

  await prisma.staffUser.update({ where: { id: target.id }, data: { active: !target.active } });
  await logAudit({
      actorType: "staff",
      actorId: staff.id,
      action: target.active ? "staff.deactivate" : "staff.activate",
      entity: "StaffUser",
      entityId: target.id,
    });
  revalidatePath("/usuarios", "layout");
  return { ok: true };
}

/**
 * Cierra TODAS las sesiones de una cuenta (navegadores y teléfonos): para cuando se perdió un aparato o se
 * sospecha de la cuenta. La persona tiene que volver a iniciar sesión.
 */
export async function revokeUserSessionsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor(ROLES.users);
  const userId = String(formData.get("userId"));
  const organizationId = await accountOrganizationId(staff, userId);
  const target = organizationId
    ? await prisma.staffUser.findFirst({ where: { id: userId, memberships: { some: { organizationId } } }, include: { memberships: { where: { organizationId } } } })
    : null;
  if (!target) return { error: "Usuario no encontrado." };
  const targetRole = target.memberships[0]?.role;
  if (targetRole && !canManageRole(staff, targetRole)) return { error: "Esa cuenta la maneja iPass." };
  if (targetRole === "OWNER" && staff.role !== "OWNER") return { error: "Solo un dueño puede cerrar las sesiones de otro dueño." };
  const { devices } = await revokeAllSessions("staff", target.id);
  await logAudit({ actorType: "staff", actorId: staff.id, action: "auth.sessions_revoked", entity: "StaffUser", entityId: target.id, data: { by: "admin", devices } });
  revalidatePath("/usuarios", "layout");
  return { ok: true };
}
