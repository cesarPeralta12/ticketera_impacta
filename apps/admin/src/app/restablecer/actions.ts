"use server";

import { redirect } from "next/navigation";
import { MIN_PASSWORD_LENGTH, resetStaffPassword } from "@ticketera/db";
import { sendStaffPasswordChangedEmail } from "@/lib/mail";

export type ResetState = { error?: string } | undefined;

export async function resetPasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  if (password !== String(formData.get("repeat") ?? "")) return { error: "Las contraseñas no coinciden." };

  const result = await resetStaffPassword(String(formData.get("token") ?? ""), password);
  if (!result.ok) return { error: "El enlace venció o ya se usó. Pide uno nuevo desde «Olvidé mi contraseña»." };
  await sendStaffPasswordChangedEmail(result.email, result.name);
  redirect("/login?cambio=ok");
}
