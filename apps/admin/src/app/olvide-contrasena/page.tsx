import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Olvidé mi contraseña" };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <p className="eyebrow">Panel de Impacta</p>
        <h1 className="text-xl font-semibold tracking-tight">Olvidé mi contraseña</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Escribe el email de tu cuenta (organizador, cajero o portero) y te enviamos un enlace para elegir una contraseña nueva.
        </p>
      </div>
      <div className="card p-6">
        <ForgotForm />
      </div>
      <Link href="/login" className="text-sm text-[var(--accent)] hover:underline">
        ← Volver a ingresar
      </Link>
    </main>
  );
}
