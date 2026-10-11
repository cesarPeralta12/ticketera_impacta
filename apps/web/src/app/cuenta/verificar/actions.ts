"use server";

import { redirect } from "next/navigation";
import { confirmCustomerEmail } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/mail";

export type VerifyState = { error?: string; message?: string } | undefined;

/** Solo rutas internas del sitio, para no redirigir a otro dominio. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** El enlace del correo solo abre la pantalla; el correo se confirma al tocar el botón (así los antivirus que "visitan" enlaces no lo gastan). */
export async function confirmEmailAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const result = await confirmCustomerEmail(String(formData.get("token") ?? ""));
  if (!result.ok) return { error: "El enlace venció o ya se usó. Pide uno nuevo." };
  redirect(safeNext(formData.get("next")));
}

export async function resendVerificationAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?next=${encodeURIComponent("/cuenta/verificar")}`);
  const result = await sendVerificationEmail(session.user.id);
  if (result === "verified") redirect(safeNext(formData.get("next")));
  if (result === "wait") return { error: "Ya te enviamos un correo hace un momento. Espera un minuto antes de pedir otro y revisa también la carpeta de spam." };
  if (result === "failed") return { error: "No pudimos enviar el correo ahora. Intenta de nuevo en unos minutos." };
  return { message: "Listo, te enviamos un correo nuevo." };
}
