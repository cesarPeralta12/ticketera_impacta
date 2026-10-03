"use server";

import { AuthError } from "next-auth";
import { MIN_PASSWORD_LENGTH, registerCustomer } from "@ticketera/db";
import { signIn } from "@/lib/auth";

export type AuthState = { error?: string } | undefined;

/** Solo rutas internas del sitio, para no redirigir a otro dominio. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/mis-eventos";
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: safeNext(formData.get("next")),
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Email o contraseña incorrectos." };
    throw error; // la redirección de éxito viaja como excepción
  }
}

export async function registerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (name.length < 3) return { error: "Ingresa tu nombre completo." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Ingresa un email válido." };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  }

  const customer = await registerCustomer({ name, email, password });
  if (!customer) return { error: "Ya existe una cuenta con ese email. Inicia sesión." };

  try {
    await signIn("credentials", { email, password, redirectTo: safeNext(formData.get("next")) });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Cuenta creada, pero no se pudo iniciar sesión. Intenta ingresar." };
    throw error;
  }
}
