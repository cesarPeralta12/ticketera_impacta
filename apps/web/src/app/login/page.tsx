import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "./auth-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

type Props = { searchParams: Promise<{ next?: string; cambio?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next, cambio } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[75vh] w-full max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <p className="eyebrow mb-1">Bienvenido de vuelta</p>
        <h1 className="font-display text-3xl">Iniciar sesión</h1>
      </div>
      {cambio === "ok" && (
        <p role="status" className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-3 text-sm">
          Contraseña cambiada. Ya puedes iniciar sesión con la nueva.
        </p>
      )}
      <AuthForm mode="login" next={next} />
      <p className="-mt-4 text-sm">
        <Link href="/olvide-contrasena" className="text-[var(--ink-muted)] underline underline-offset-4 hover:text-[var(--ink)]">
          ¿Olvidaste tu contraseña?
        </Link>
      </p>
      <p className="text-sm text-[var(--ink-muted)]">
        ¿No tienes cuenta?{" "}
        <Link href={`/registro${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-[var(--accent)] underline underline-offset-4">
          Regístrate
        </Link>
        . Para comprar entradas necesitas una cuenta con tu carnet de identidad.
      </p>
    </main>
  );
}
