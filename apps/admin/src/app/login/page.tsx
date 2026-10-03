import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] font-mono text-sm font-medium text-[var(--accent-ink)]">
          I
        </span>
        <div>
          <p className="eyebrow">Panel de organizador</p>
          <h1 className="text-xl font-semibold tracking-tight">Impacta</h1>
        </div>
      </div>
      <div className="card p-6">
        <LoginForm next={next} />
      </div>
      <p className="text-xs text-[var(--ink-dim)]">
        Las cuentas del panel las crea un administrador desde Usuarios. No hay registro público.
      </p>
    </main>
  );
}
