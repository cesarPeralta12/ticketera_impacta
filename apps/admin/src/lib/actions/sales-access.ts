"use server";

import { revalidatePath } from "next/cache";
import { DomainError, POS_METHODS, addSessionSeller, prisma, removeSalesAssignment, setSalesAssignment, toggleSalesAssignment, updateSalesSettings } from "@ticketera/db";
import { accountOrganizationId, organizationScope } from "@/lib/account-scope";
import { logAudit } from "@/lib/audit";
import type { FormState } from "@/lib/forms";
import { readSessionPick } from "@/lib/session-pick";
import { ROLES, requireEditor } from "@/lib/session";

async function audit(actorId: string, action: string, entityId: string, data?: object) {
  await logAudit({ actorType: "staff", actorId, action, entity: "StaffUser", entityId, data: data ? JSON.parse(JSON.stringify(data)) : undefined });
}

/** Un cajero de la organización (las asignaciones de los promotores se hacen en Promotores, con su comisión). */
async function cashier(organizationId: string, userId: string) {
  return prisma.membership.findFirst({ where: { organizationId, userId, role: "CASHIER" } });
}

/** Un cajero o una cuenta de barra: a las dos se les asignan noches/funciones. */
async function assignable(organizationId: string, userId: string) {
  return prisma.membership.findFirst({ where: { organizationId, userId, role: { in: ["CASHIER", "BAR"] } } });
}

/** Qué vende un cajero (todo, o solo lo asignado) y con qué medios puede cobrar. */
export async function updateSalesSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor(ROLES.users);
  const userId = String(formData.get("userId") ?? "");
  const organizationId = await accountOrganizationId(staff, userId);
  if (!organizationId || !(await cashier(organizationId, userId))) return { error: "Cajero no encontrado." };
  const salesScope = formData.get("salesScope") === "ASSIGNED" ? "ASSIGNED" : "ALL";
  const posMethods = formData.getAll("posMethods").map(String).filter((m) => (POS_METHODS as readonly string[]).includes(m));
  if (posMethods.length === 0) return { fieldErrors: { posMethods: "Deja al menos un medio de cobro." } };
  await updateSalesSettings({ organizationId, userId, salesScope, posMethods });
  await audit(staff.id, "sales.settings", userId, { salesScope, posMethods });
  revalidatePath(`/usuarios/${userId}`);
  return { ok: true, message: "Guardado." };
}

/** Asigna a un cajero un evento completo o algunas de sus funciones (con vigencia opcional). */
export async function assignCashierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor(ROLES.users);
  const userId = String(formData.get("userId") ?? "");
  const organizationId = await accountOrganizationId(staff, userId);
  if (!organizationId || !(await assignable(organizationId, userId))) return { error: "Cuenta no encontrada." };
  const pick = readSessionPick(formData);
  if (!pick.ok) return { fieldErrors: { [pick.field]: "message" in pick && pick.message ? pick.message : "Fecha inválida." } };
  try {
    const result = await setSalesAssignment(prisma, { organizationId, userId, ...pick });
    await audit(staff.id, "sales.assign", userId, { eventId: pick.eventId, sessionIds: pick.sessionIds ?? "todas", startsAt: pick.startsAt, endsAt: pick.endsAt });
    revalidatePath(`/usuarios/${userId}`);
    return { ok: true, message: result.whole ? "Asignado el evento completo." : `Asignadas ${result.sessions} función(es).` };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

export async function removeSalesAssignmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor(ROLES.users);
  const id = String(formData.get("assignmentId") ?? "");
  const assignment = await prisma.salesAssignment.findFirst({ where: { id, event: organizationScope(staff) }, include: { event: { select: { organizationId: true } } } });
  if (!assignment || !(await removeSalesAssignment(assignment.event.organizationId, id))) return { error: "Asignación no encontrada." };
  await audit(staff.id, "sales.unassign", assignment.userId, { eventId: assignment.eventId, sessionId: assignment.sessionId });
  revalidatePath(`/usuarios/${assignment.userId}`);
  revalidatePath("/eventos", "layout");
  return { ok: true };
}

export async function toggleSalesAssignmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor(ROLES.users);
  const target = await prisma.salesAssignment.findFirst({ where: { id: String(formData.get("assignmentId") ?? ""), event: organizationScope(staff) }, include: { event: { select: { organizationId: true } } } });
  const updated = target ? await toggleSalesAssignment(target.event.organizationId, target.id) : null;
  if (!updated) return { error: "Asignación no encontrada." };
  await audit(staff.id, updated.active ? "sales.assignment_on" : "sales.assignment_off", updated.userId, { assignmentId: updated.id });
  revalidatePath(`/usuarios/${updated.userId}`);
  return { ok: true };
}

/** Desde la pantalla de una función: suma un cajero o promotor a los que pueden venderla. */
export async function addSessionSellerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor(ROLES.users);
  const userId = String(formData.get("userId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  try {
    await addSessionSeller({ organizationId: staff.organization.id, userId, sessionId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  await audit(staff.id, "sales.assign", userId, { sessionId });
  revalidatePath("/eventos", "layout");
  return { ok: true, message: "Ya puede vender esta función." };
}
