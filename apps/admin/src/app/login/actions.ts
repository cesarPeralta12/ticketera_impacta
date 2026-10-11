"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { LIMITS, hit, isLimited, prisma, recordHit, recordLogin, recordLoginFailure, verifyStaffCredentials } from "@ticketera/db";
import { signIn } from "@/lib/auth";
import { TOO_MANY_ATTEMPTS, requestContext } from "@/lib/client-ip";
import { HOME_BY_ROLE } from "@/lib/session";

export type LoginState = { error?: string } | undefined;

/** Solo acepta rutas internas del panel, para no redirigir a otro sitio. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && next !== "/" ? next : null;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  // Límites: por IP (todos los intentos) y por cuenta (solo las contraseñas incorrectas).
  const context = await requestContext();
  if (!(await hit(`login:ip:${context.ip}`, LIMITS.loginByIp)) || (await isLimited(`login:fail:${email}`, LIMITS.loginFailuresByAccount))) {
    await recordLoginFailure({ kind: "staff", email, reason: "BLOCKED", context });
    return { error: TOO_MANY_ATTEMPTS };
  }
  // El portero usa solo la app móvil: no abre sesión en el panel web.
  const account = await verifyStaffCredentials(email, String(formData.get("password") ?? ""));
  if (account?.role === "OPERATOR") {
    await recordLoginFailure({ kind: "staff", email, reason: "ROLE", context });
    return { error: "Esta cuenta es de portero: usa la app móvil Impacta Puerta." };
  }
  try {
    await signIn("credentials", { email, password: formData.get("password"), redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      await recordHit(`login:fail:${email}`);
      await recordLoginFailure({ kind: "staff", email, reason: "CREDENTIALS", context });
      return { error: "Email o contraseña incorrectos." };
    }
    throw error;
  }
  if (account) await recordLogin({ kind: "staff", userId: account.id, context });
  // Sin destino pedido, cada rol entra directo a su pantalla (boletería, cliente…).
  const membership = await prisma.membership.findFirst({ where: { user: { email } }, select: { role: true } });
  redirect(safeNext(formData.get("next")) ?? (membership ? HOME_BY_ROLE[membership.role] : "/"));
}
