"use server";

import { sendPasswordResetEmail } from "@/lib/mail";

export type ForgotState = { sent?: boolean; error?: string } | undefined;

/** Siempre responde lo mismo: no se revela si el email tiene cuenta. */
export async function forgotPasswordAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Ingresa un email válido." };
  await sendPasswordResetEmail(email);
  return { sent: true };
}
