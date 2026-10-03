"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@ticketera/db";
import { signIn } from "@/lib/auth";
import { HOME_BY_ROLE } from "@/lib/session";

export type LoginState = { error?: string } | undefined;

/** Solo acepta rutas internas del panel, para no redirigir a otro sitio. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && next !== "/" ? next : null;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  try {
    await signIn("credentials", { email, password: formData.get("password"), redirect: false });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Email o contraseña incorrectos." };
    throw error;
  }
  // Sin destino pedido, cada rol entra directo a su pantalla (puerta, boletería, cliente…).
  const membership = await prisma.membership.findFirst({ where: { user: { email } }, select: { role: true } });
  redirect(safeNext(formData.get("next")) ?? (membership ? HOME_BY_ROLE[membership.role] : "/"));
}
