import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { MIN_PASSWORD_LENGTH } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { changePasswordAction, signOutEverywhereAction } from "@/lib/actions/account";
import { HOME_BY_ROLE, ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Cambiar contraseña" };

/** Cambio de contraseña de cualquier cuenta. Obligatorio la primera vez (contraseña temporal). */
export default async function ChangePasswordPage() {
  await connection();
  const staff = await requireStaff(ROLES.any);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <p className="eyebrow">{staff.home.name}</p>
        <h1 className="text-xl font-semibold tracking-tight">
          {staff.mustChangePassword ? "Crea tu contraseña" : "Cambiar contraseña"}
        </h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {staff.mustChangePassword
            ? "Entraste con una contraseña temporal. Elige una propia para seguir: solo tú la vas a conocer."
            : `Hola, ${staff.name}.`}
        </p>
      </div>
      <ActionForm action={changePasswordAction} className="card flex flex-col gap-4 p-6">
        <label className="label">
          Contraseña actual {staff.mustChangePassword && "(la temporal)"}
          <input name="current" type="password" required autoComplete="current-password" className="field" />
        </label>
        <label className="label">
          Nueva contraseña
          <input
            name="next"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="field"
          />
          <span className="text-xs font-normal text-[var(--ink-dim)]">
            Al menos {MIN_PASSWORD_LENGTH} caracteres. Mejor una frase que solo tú recuerdes.
          </span>
        </label>
        <label className="label">
          Repite la nueva contraseña
          <input name="confirm" type="password" required autoComplete="new-password" className="field" />
        </label>
        <button type="submit" className="btn btn-primary">
          Guardar contraseña
        </button>
      </ActionForm>
      {!staff.mustChangePassword && (
        <form action={signOutEverywhereAction} className="card flex flex-col gap-2 p-6">
          <h2 className="text-sm font-semibold">Sesiones</h2>
          <p className="text-xs text-[var(--ink-muted)]">
            ¿Entraste desde un aparato ajeno o perdiste un teléfono? Cierra la sesión en todos los navegadores y teléfonos.
          </p>
          <button type="submit" className="btn">
            Cerrar todas mis sesiones
          </button>
        </form>
      )}
      {!staff.mustChangePassword && (
        <Link href={HOME_BY_ROLE[staff.role]} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Volver
        </Link>
      )}
    </main>
  );
}
