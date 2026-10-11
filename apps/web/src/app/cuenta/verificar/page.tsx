import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isEmailTokenValid, prisma } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { ConfirmForm, ResendForm } from "./verify-forms";

export const metadata: Metadata = { title: "Confirma tu correo", robots: { index: false } };

type Props = { searchParams: Promise<{ token?: string; next?: string }> };

/**
 * Dos usos: (1) con ?token= (el enlace del correo) muestra el botón para confirmar;
 * (2) sin token (viniendo de comprar) explica que hay que confirmar el correo y permite reenviarlo.
 */
export default async function VerifyEmailPage({ searchParams }: Props) {
  await connection();
  const { token, next } = await searchParams;

  if (token) {
    const valid = await isEmailTokenValid(token, "VERIFY_EMAIL");
    return (
      <main className="mx-auto flex min-h-[75vh] w-full max-w-sm flex-col justify-center gap-6 px-6">
        <div>
          <p className="eyebrow mb-1">Un último paso</p>
          <h1 className="font-display text-3xl">Confirma tu correo</h1>
        </div>
        {valid ? (
          <>
            <p className="text-sm text-[var(--ink-muted)]">Toca el botón para confirmar que este correo es tuyo. Ahí te enviaremos tus entradas.</p>
            <ConfirmForm token={token} next={next} />
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--accent-2)]">Este enlace venció o ya se usó.</p>
            <Link href={`/cuenta/verificar${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="btn-accent text-center">
              Pedir un enlace nuevo
            </Link>
          </>
        )}
      </main>
    );
  }

  const session = await auth();
  const customer = session?.user?.id
    ? await prisma.customer.findUnique({ where: { id: session.user.id }, select: { email: true, emailVerified: true } })
    : null;
  if (!customer) redirect(`/login?next=${encodeURIComponent(`/cuenta/verificar${next ? `?next=${encodeURIComponent(next)}` : ""}`)}`);
  if (customer.emailVerified) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/mis-eventos");

  return (
    <main className="mx-auto flex min-h-[75vh] w-full max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <p className="eyebrow mb-1">Falta confirmar tu correo</p>
        <h1 className="font-display text-3xl">Revisa tu correo</h1>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          Te enviamos un enlace a <strong className="text-[var(--ink)]">{customer.email}</strong>. Ábrelo y confirma para poder comprar: ahí
          mismo recibirás tus entradas. Si no lo ves, revisa la carpeta de spam.
        </p>
      </div>
      <ResendForm next={next} />
    </main>
  );
}
