"use server";

import { redirect } from "next/navigation";
import { MIN_PASSWORD_LENGTH, changeStaffPassword, prisma } from "@ticketera/db";
import type { FormState } from "@/lib/forms";
import { HOME_BY_ROLE, ROLES, requireStaff } from "@/lib/session";

/** Cualquier cuenta del panel cambia su contraseña (obligatorio si era temporal). */
export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.any);
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < MIN_PASSWORD_LENGTH) {
    return { fieldErrors: { next: `La nueva contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.` } };
  }
  if (next !== confirm) return { fieldErrors: { confirm: "Las dos contraseñas nuevas no coinciden." } };
  if (next === current) return { fieldErrors: { next: "La nueva contraseña tiene que ser distinta de la actual." } };
  if (!(await changeStaffPassword(staff.id, current, next))) {
    return { fieldErrors: { current: "La contraseña actual no es correcta." } };
  }
  await prisma.auditLog.create({
    data: { actorType: "staff", actorId: staff.id, action: "staff.password", entity: "StaffUser", entityId: staff.id },
  });
  redirect(`${HOME_BY_ROLE[staff.role]}?clave=ok`);
}
