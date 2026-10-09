"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { DOCUMENT_ERROR } from "@ticketera/core";
import { LIMITS, MIN_PASSWORD_LENGTH, hit, isLimited, prisma, recordHit, recordLogin, recordLoginFailure, registerCustomer } from "@ticketera/db";
import { signIn } from "@/lib/auth";
import { TOO_MANY_ATTEMPTS, clientIp, requestContext } from "@/lib/client-ip";
import { sendVerificationEmail } from "@/lib/mail";

export type AuthState = { error?: string } | undefined;

/** Solo rutas internas del sitio, para no redirigir a otro dominio. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/mis-eventos";
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  // Límites: por IP (todos los intentos) y por cuenta (solo las contraseñas incorrectas).
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const context = await requestContext();
  if (!(await hit(`login:ip:${context.ip}`, LIMITS.loginByIp)) || (await isLimited(`login:fail:${email}`, LIMITS.loginFailuresByAccount))) {
    await recordLoginFailure({ kind: "customer", email, reason: "BLOCKED", context });
    return { error: TOO_MANY_ATTEMPTS };
  }
  try {
    await signIn("credentials", { email: formData.get("email"), password: formData.get("password"), redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      await recordHit(`login:fail:${email}`);
      await recordLoginFailure({ kind: "customer", email, reason: "CREDENTIALS", context });
      return { error: "Email o contraseña incorrectos." };
    }
    throw error;
  }
  const customer = await prisma.customer.findUnique({ where: { email }, select: { id: true } });
  if (customer) await recordLogin({ kind: "customer", userId: customer.id, context });
  redirect(safeNext(formData.get("next")));
}

export async function registerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!(await hit(`register:ip:${await clientIp()}`, LIMITS.registerByIp))) return { error: TOO_MANY_ATTEMPTS };
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (name.length < 3) return { error: "Ingresa tu nombre completo." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Ingresa un email válido." };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  }

  const result = await registerCustomer({
    name,
    email,
    password,
    document: String(formData.get("document") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  });
  if ("error" in result) {
    return {
      error: {
        EMAIL_TAKEN: "Ya existe una cuenta con ese email. Inicia sesión.",
        DOCUMENT_TAKEN: "Ese carnet ya tiene una cuenta. Inicia sesión con ella.",
        DOCUMENT_INVALID: DOCUMENT_ERROR,
      }[result.error],
    };
  }

  // Confirmar el correo es obligatorio para comprar: se envía el enlace al crear la cuenta.
  await sendVerificationEmail(result.customer.id);

  try {
    await signIn("credentials", { email, password, redirectTo: safeNext(formData.get("next")) });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Cuenta creada, pero no se pudo iniciar sesión. Intenta ingresar." };
    throw error;
  }
}
