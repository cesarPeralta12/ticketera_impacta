"use client";

import { useActionState } from "react";
import { saveProfileAction } from "./actions";

export function ProfileForm({
  next,
  defaults,
}: {
  next?: string;
  defaults: { name: string; document: string; phone: string; email: string };
}) {
  const [state, formAction, pending] = useActionState(saveProfileAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="flex flex-col gap-1.5 text-sm text-[var(--ink-muted)]">
        Email
        <input value={defaults.email} readOnly className="field opacity-70" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-[var(--ink-muted)]">
        Nombre completo
        <input name="name" required defaultValue={defaults.name} autoComplete="name" className="field" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-[var(--ink-muted)]">
        Carnet de identidad
        <input name="document" required defaultValue={defaults.document} autoComplete="off" placeholder="1234567 LP" className="field" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-[var(--ink-muted)]">
        Celular (opcional)
        <input name="phone" type="tel" defaultValue={defaults.phone} autoComplete="tel" className="field" />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-[var(--accent-2)]">
          {state.error}
        </p>
      )}
      {state?.ok && <p className="text-sm text-[var(--accent)]">Datos guardados.</p>}
      <button type="submit" disabled={pending} className="btn-accent mt-1">
        {pending ? "Guardando…" : next ? "Guardar y continuar" : "Guardar"}
      </button>
    </form>
  );
}
