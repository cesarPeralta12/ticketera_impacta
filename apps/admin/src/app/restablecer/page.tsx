import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { MIN_PASSWORD_LENGTH, isEmailTokenValid } from "@ticketera/db";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Contraseña nueva" };

type Props = { searchParams: Promise<{ token?: string }> };

export default async function ResetPasswordPage({ searchParams }: Props) {
  await connection();
  const { token } = await searchParams;
  const valid = token ? await isEmailTokenValid(token, "RESET_PASSWORD") : false;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <p className="eyebrow">Panel de Impacta</p>
        <h1 className="text-xl font-semibold tracking-tight">Elige tu contraseña nueva</h1>
      </div>
      <div className="card p-6">
        {valid && token ? (
          <ResetForm token={token} minLength={MIN_PASSWORD_LENGTH} />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[var(--danger)]">Este enlace venció o ya se usó.</p>
            <Link href="/olvide-contrasena" className="btn btn-primary">
              Pedir un enlace nuevo
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
