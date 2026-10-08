"use server";

import { redirect } from "next/navigation";
import { DOCUMENT_ERROR } from "@ticketera/core";
import { MIN_PASSWORD_LENGTH, changeCustomerPassword, updateCustomerProfile } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { sendPasswordChangedEmail } from "@/lib/mail";

export type ProfileState = { error?: string; ok?: boolean } | undefined;

/** Solo rutas internas del sitio, para no redirigir a otro dominio. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export async function saveProfileAction(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 3) return { error: "Ingresa tu nombre completo." };

  const result = await updateCustomerProfile(session.user.id, {
    name,
    document: String(formData.get("document") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  });
  if ("error" in result) {
    return {
      error:
        result.error === "DOCUMENT_TAKEN"
          ? "Ese carnet ya está registrado en otra cuenta. Si es tuyo, inicia sesión con esa cuenta."
          : DOCUMENT_ERROR,
    };
  }
  const next = safeNext(formData.get("next"));
  if (next) redirect(next);
  return { ok: true };
}

export type PasswordState = { error?: string; ok?: boolean } | undefined;

/** Cambio de contraseña dentro de la cuenta: pide la actual y avisa por correo. */
export async function changePasswordAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const next = String(formData.get("next") ?? "");
  if (next.length < MIN_PASSWORD_LENGTH) return { error: `La contraseña nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  if (next !== String(formData.get("repeat") ?? "")) return { error: "Las contraseñas nuevas no coinciden." };
  const result = await changeCustomerPassword(session.user.id, String(formData.get("current") ?? ""), next);
  if (!result.ok) return { error: result.reason === "WRONG_PASSWORD" ? "La contraseña actual no es correcta." : "La contraseña nueva es muy corta." };
  await sendPasswordChangedEmail(result.email, result.name);
  return { ok: true };
}
