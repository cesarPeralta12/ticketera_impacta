import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { MIN_PASSWORD_LENGTH, isEmailTokenValid } from "@ticketera/db";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Contraseña nueva", robots: { index: false } };

type Props = { searchParams: Promise<{ token?: string }> };

export default async function ResetPasswordPage({ searchParams }: Props) {
  await connection();
  const { token } = await searchParams;
  const valid = token ? await isEmailTokenValid(token, "RESET_PASSWORD") : false;

  return (
    <main className="mx-auto flex min-h-[75vh] w-full max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <p className="eyebrow mb-1">Recupera tu cuenta</p>
        <h1 className="font-display text-3xl">Elige tu contraseña nueva</h1>
      </div>
      {valid && token ? (
        <ResetForm token={token} minLength={MIN_PASSWORD_LENGTH} />
      ) : (
        <>
          <p className="text-sm text-[var(--accent-2)]">Este enlace venció o ya se usó.</p>
          <Link href="/olvide-contrasena" className="btn-accent text-center">
            Pedir un enlace nuevo
          </Link>
        </>
      )}
    </main>
  );
}
