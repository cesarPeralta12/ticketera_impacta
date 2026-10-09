"use server";

import { MIN_PASSWORD_LENGTH, changeStaffPassword, revokeAllSessions } from "@ticketera/db";
import { signIn, signOut } from "@/lib/auth";
import type { FormState } from "@/lib/forms";
import { HOME_BY_ROLE, ROLES, requireStaff } from "@/lib/session";
import { logAudit } from "@/lib/audit";

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
  await logAudit({ actorType: "staff", actorId: staff.id, action: "auth.password_changed", entity: "StaffUser", entityId: staff.id });
  // El cambio cierra todas las sesiones y teléfonos; esta se vuelve a abrir con la clave nueva y sigue su camino.
  await signIn("credentials", { email: staff.email, password: next, redirectTo: `${HOME_BY_ROLE[staff.role]}?clave=ok` });
  return undefined;
}

/** "Cerrar todas mis sesiones": otros navegadores y teléfonos pierden el acceso; también cierra esta. */
export async function signOutEverywhereAction() {
  const staff = await requireStaff(ROLES.any);
  await revokeAllSessions("staff", staff.id);
  await logAudit({ actorType: "staff", actorId: staff.id, action: "auth.sessions_revoked", entity: "StaffUser", entityId: staff.id });
  await signOut({ redirectTo: "/login" });
}
