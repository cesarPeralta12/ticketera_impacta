"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  DomainError,
  MIN_PASSWORD_LENGTH,
  approveEvent,
  createOrganizer,
  prisma,
  rejectEvent,
  setMaxActiveEvents,
  setSelfManaged,
  setOrganizationStatus,
} from "@ticketera/db";
import { formObject, zodErrors, type FormState } from "@/lib/forms";
import { HOME_BY_ROLE, PREVIEW_ROLES, PREVIEW_ROLE_COOKIE, ROLES, VIEW_AS_COOKIE, requirePlatform, requireStaff } from "@/lib/session";

/** Solo rutas internas del panel. */
function safePath(value: FormDataEntryValue | null, fallback: string) {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

const VIEW_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 8 * 60 * 60,
} as const;

/** IMPACTA entra a trabajar dentro de un organizador: ve y edita exactamente lo que él ve. */
export async function enterOrganizationAction(formData: FormData) {
  await requirePlatform();
  const organization = await prisma.organization.findUnique({ where: { id: String(formData.get("organizationId")) } });
  if (!organization || organization.isPlatform) redirect("/organizadores");
  const jar = await cookies();
  jar.set(VIEW_AS_COOKIE, organization.id, VIEW_COOKIE_OPTIONS);
  jar.delete(PREVIEW_ROLE_COOKIE);
  redirect(safePath(formData.get("next"), "/"));
}

export async function exitOrganizationAction(formData: FormData) {
  await requirePlatform();
  const jar = await cookies();
  jar.delete(VIEW_AS_COOKIE);
  jar.delete(PREVIEW_ROLE_COOKIE);
  redirect(safePath(formData.get("next"), "/organizadores"));
}

/**
 * Dentro de un organizador, IMPACTA mira el panel como lo ve una de sus cuentas (administrador del organizador o
 * cajero) antes de entregar los accesos: mismo menú y mismas pantallas, sin poder cambiar nada. Sin `role`, vuelve
 * a trabajar normal dentro del organizador. No usa requirePlatform: durante la vista previa la cuenta actúa con el
 * rol que se mira, pero solo llega aquí quien "entró" a un organizador (eso ya exige ser administrador de IMPACTA).
 */
export async function previewAsAction(formData: FormData) {
  const staff = await requireStaff(ROLES.any);
  if (!staff.viewingAs) redirect("/");
  const role = PREVIEW_ROLES.find((r) => r === formData.get("role"));
  const jar = await cookies();
  if (role) jar.set(PREVIEW_ROLE_COOKIE, role, VIEW_COOKIE_OPTIONS);
  else jar.delete(PREVIEW_ROLE_COOKIE);
  redirect(role ? HOME_BY_ROLE[role] : "/");
}

const organizerSchema = z.object({
  name: z.string({ error: "Ingresa el nombre del organizador." }).min(2, "El nombre es muy corto.").max(120),
  taxId: z.string().max(30).optional(),
  contactEmail: z.string().toLowerCase().pipe(z.email("Email de contacto inválido.")).optional(),
  adminName: z.string({ error: "Ingresa el nombre del responsable." }).min(3, "El nombre es muy corto.").max(120),
  adminEmail: z.string({ error: "Ingresa el email de la cuenta." }).toLowerCase().pipe(z.email("Email inválido.")),
  adminPassword: z
    .string({ error: "Ingresa una contraseña temporal." })
    .min(MIN_PASSWORD_LENGTH, `La contraseña temporal necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`),
  /** Usuario de eventos o de boliche. */
  kind: z.enum(["EVENTS", "NIGHTLIFE"]).default("EVENTS"),
  /** Qué puede hacer su dueño: solo ver (por defecto) o ver y editar con aprobación. */
  permission: z.enum(["view", "edit"]).default("view"),
});

/** Alta de un organizador con su cuenta de administrador (contraseña temporal). */
export async function createOrganizerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePlatform();
  const parsed = organizerSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const data = parsed.data;
  try {
    await createOrganizer({
      name: data.name,
      kind: data.kind,
      taxId: data.taxId,
      contactEmail: data.contactEmail,
      admin: { name: data.adminName, email: data.adminEmail, password: data.adminPassword },
      selfManaged: data.permission === "edit",
      actorId: staff.id,
    });
  } catch (error) {
    if (error instanceof DomainError) return { fieldErrors: { adminEmail: error.message } };
    throw error;
  }
  revalidatePath("/organizadores");
  return {
    ok: true,
    message: `${data.kind === "NIGHTLIFE" ? "Boliche" : "Organizador"} creado. Ya puede entrar al panel con ${data.adminEmail} y la contraseña temporal (${data.permission === "edit" ? "puede editar; lo que publique pasa por tu aprobación" : "solo lectura"}).`,
  };
}

export async function setOrganizerStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePlatform();
  const status = formData.get("status") === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
  try {
    await setOrganizationStatus(String(formData.get("organizationId")), status, staff.id);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath("/organizadores");
  return { ok: true };
}

export async function approveEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePlatform();
  try {
    await approveEvent(String(formData.get("eventId")), staff.id);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath("/aprobaciones");
  return { ok: true };
}

export async function rejectEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePlatform();
  try {
    await rejectEvent(String(formData.get("eventId")), String(formData.get("note") ?? ""), staff.id);
  } catch (error) {
    if (error instanceof DomainError) return { fieldErrors: { note: error.message } };
    throw error;
  }
  revalidatePath("/aprobaciones");
  return { ok: true };
}

/** Da o quita la administración propia de un organizador o boliche (puede crear y editar lo suyo, con aprobación). */
export async function setSelfManagedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePlatform();
  const on = formData.get("selfManaged") === "true";
  try {
    await setSelfManaged(String(formData.get("organizationId")), on, staff.id);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath("/organizadores", "layout");
  return { ok: true, message: on ? "Ahora administra por sí mismo: lo que publique pasa por tu aprobación." : "Vuelve a solo lectura." };
}

/** Fija el máximo de eventos activos de un organizador (vacío = sin límite). */
export async function setEventLimitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePlatform();
  const raw = String(formData.get("maxActiveEvents") ?? "").trim();
  const limit = raw === "" ? null : Number(raw);
  try {
    await setMaxActiveEvents(String(formData.get("organizationId")), limit, staff.id);
  } catch (error) {
    if (error instanceof DomainError) return { fieldErrors: { maxActiveEvents: error.message } };
    throw error;
  }
  revalidatePath("/organizadores", "layout");
  return { ok: true };
}
