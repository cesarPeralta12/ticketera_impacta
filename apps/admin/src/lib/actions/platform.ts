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
  setOrganizationStatus,
} from "@ticketera/db";
import { formObject, zodErrors, type FormState } from "@/lib/forms";
import { VIEW_AS_COOKIE, requirePlatform } from "@/lib/session";

/** Solo rutas internas del panel. */
function safePath(value: FormDataEntryValue | null, fallback: string) {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

/** IMPACTA entra a trabajar dentro de un organizador: ve y edita exactamente lo que él ve. */
export async function enterOrganizationAction(formData: FormData) {
  await requirePlatform();
  const organization = await prisma.organization.findUnique({ where: { id: String(formData.get("organizationId")) } });
  if (!organization || organization.isPlatform) redirect("/organizadores");
  (await cookies()).set(VIEW_AS_COOKIE, organization.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  redirect(safePath(formData.get("next"), "/"));
}

export async function exitOrganizationAction(formData: FormData) {
  await requirePlatform();
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect(safePath(formData.get("next"), "/organizadores"));
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
      taxId: data.taxId,
      contactEmail: data.contactEmail,
      admin: { name: data.adminName, email: data.adminEmail, password: data.adminPassword },
      actorId: staff.id,
    });
  } catch (error) {
    if (error instanceof DomainError) return { fieldErrors: { adminEmail: error.message } };
    throw error;
  }
  revalidatePath("/organizadores");
  return { ok: true };
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
