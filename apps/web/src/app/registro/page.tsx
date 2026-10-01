import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "../login/auth-form";

export const metadata: Metadata = { title: "Crear cuenta" };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function RegisterPage({ searchParams }: Props) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[75vh] w-full max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <p className="eyebrow mb-1">Tus entradas, siempre a mano</p>
        <h1 className="font-display text-3xl">Crear cuenta</h1>
      </div>
      <AuthForm mode="register" next={next} />
      <p className="text-sm text-[var(--ink-muted)]">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="text-[var(--accent)] underline underline-offset-4">
          Inicia sesión
        </Link>
      </p>
    </main>
  );
}
