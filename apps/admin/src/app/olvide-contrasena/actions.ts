"use server";

import { LIMITS, hit } from "@ticketera/db";
import { TOO_MANY_ATTEMPTS, clientIp } from "@/lib/client-ip";
import { sendStaffResetEmail } from "@/lib/mail";

export type ForgotState = { sent?: boolean; error?: string } | undefined;

/** Siempre responde lo mismo: no se revela si el email tiene una cuenta del panel. */
export async function forgotPasswordAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Ingresa un email válido." };
  if (!(await hit(`forgot:ip:${await clientIp()}`, LIMITS.forgotByIp))) return { error: TOO_MANY_ATTEMPTS };
  await sendStaffResetEmail(email);
  return { sent: true };
}
