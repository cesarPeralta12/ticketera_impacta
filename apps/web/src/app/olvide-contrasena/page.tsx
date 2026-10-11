import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Olvidé mi contraseña", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-[75vh] w-full max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <p className="eyebrow mb-1">Recupera tu cuenta</p>
        <h1 className="font-display text-3xl">Olvidé mi contraseña</h1>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">Escribe tu email y te enviamos un enlace para elegir una contraseña nueva.</p>
      </div>
      <ForgotForm />
      <p className="text-sm text-[var(--ink-muted)]">
        <Link href="/login" className="text-[var(--accent)] underline underline-offset-4">
          Volver a iniciar sesión
        </Link>
      </p>
    </main>
  );
}
