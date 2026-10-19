import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

type Props = { searchParams: Promise<{ next?: string; cambio?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next, cambio } = await searchParams;
  return (
    <main className="page-enter mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div className="flex items-center gap-2.5">
        <span className="brand-tile flex h-10 w-10 items-center justify-center rounded-lg text-base font-bold">I</span>
        <div>
          <p className="eyebrow">Panel de organizador</p>
          <h1 className="text-xl font-semibold tracking-tight">Impacta</h1>
        </div>
      </div>
      {cambio === "ok" && (
        <p role="status" className="rounded-md bg-[var(--accent-soft)] px-3 py-2.5 text-sm text-[var(--accent)]">
          Contraseña cambiada. Ya puedes ingresar con la nueva.
        </p>
      )}
      <div className="card p-6">
        <LoginForm next={next} />
        <p className="mt-4 text-sm">
          <Link href="/olvide-contrasena" className="text-[var(--ink-muted)] hover:text-[var(--ink)] hover:underline">
            ¿Olvidaste tu contraseña?
          </Link>
        </p>
      </div>
      <p className="text-xs text-[var(--ink-dim)]">
        Las cuentas del panel las crea un administrador desde Usuarios. No hay registro público.
      </p>
    </main>
  );
}
