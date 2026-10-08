import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MIN_PASSWORD_LENGTH, prisma } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { PasswordForm, ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Mis datos", robots: { index: false } };

type Props = { searchParams: Promise<{ next?: string }> };

/** Datos de la cuenta. El carnet es obligatorio para comprar: las entradas salen a nombre de quien compra. */
export default async function ProfilePage({ searchParams }: Props) {
  await connection();
  const { next } = await searchParams;
  const session = await auth();
  const customer = session?.user?.id
    ? await prisma.customer.findUnique({ where: { id: session.user.id } })
    : null;
  if (!customer) redirect(`/login?next=${encodeURIComponent("/cuenta/datos")}`);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-6 py-12">
      <div>
        <p className="eyebrow mb-1">{customer.documentId ? "Tu cuenta" : "Falta un dato para comprar"}</p>
        <h1 className="font-display text-3xl">Mis datos</h1>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">
          Tus entradas salen a tu nombre y con tu carnet; son los datos que se verifican en la puerta. Cada carnet
          puede tener una sola cuenta.
        </p>
      </div>
      <ProfileForm
        next={next}
        defaults={{ name: customer.name, document: customer.documentId ?? "", phone: customer.phone ?? "", email: customer.email }}
      />
      <section className="mt-6 flex flex-col gap-4 border-t border-[var(--border)] pt-6">
        <h2 className="font-display text-xl">Cambiar contraseña</h2>
        <PasswordForm minLength={MIN_PASSWORD_LENGTH} />
      </section>
    </main>
  );
}
