import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "./auth-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[75vh] w-full max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <p className="eyebrow mb-1">Bienvenido de vuelta</p>
        <h1 className="font-display text-3xl">Iniciar sesión</h1>
      </div>
      <AuthForm mode="login" next={next} />
      <p className="text-sm text-[var(--ink-muted)]">
        ¿No tienes cuenta?{" "}
        <Link href={`/registro${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-[var(--accent)] underline underline-offset-4">
          Regístrate
        </Link>
        . No hace falta para comprar: sirve para ver tus entradas en un solo lugar.
      </p>
    </main>
  );
}
