import type { StaffRole } from "@ticketera/db";
import { prisma } from "@ticketera/db";
import type { Staff } from "./session";

/** Cuentas de personal: las que un organizador con administración propia puede crear y manejar (no otros administradores). */
export const STAFF_ROLES: StaffRole[] = ["OPERATOR", "CASHIER", "PROMOTER", "BAR"];

/**
 * ¿Esta cuenta puede manejar a alguien con ese rol? iPass, cualquiera; un organizador con administración propia, solo su
 * personal (portero, cajero, barra, promotor): no a su dueño, a otro administrador ni a las cuentas de iPass.
 */
export function canManageRole(staff: Staff, role: StaffRole): boolean {
  return staff.platform || STAFF_ROLES.includes(role);
}

/**
 * La organización de la cuenta `userId` que `staff` puede administrar, o null si no puede. iPass administra las
 * cuentas de todos los organizadores sin "entrar" en ellos (usa la organización a la que pertenece la cuenta); un
 * organizador, solo las de la suya.
 */
export async function accountOrganizationId(staff: Staff, userId: string): Promise<string | null> {
  if (!staff.platform) {
    const own = await prisma.membership.findFirst({ where: { userId, organizationId: staff.organization.id }, select: { organizationId: true } });
    return own?.organizationId ?? null;
  }
  const memberships = await prisma.membership.findMany({ where: { userId }, select: { organizationId: true }, orderBy: { createdAt: "asc" } });
  if (memberships.length === 0) return null;
  return memberships.find((m) => m.organizationId === staff.organization.id)?.organizationId ?? memberships[0]!.organizationId;
}

/** Filtro de organización para buscar por id algo que `staff` puede administrar (iPass: de cualquier organizador). */
export const organizationScope = (staff: Staff) => (staff.platform ? {} : { organizationId: staff.organization.id });
