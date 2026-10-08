"use client";

import { useActionState } from "react";
import { forgotPasswordAction } from "./actions";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, undefined);
  if (state?.sent) {
    return (
      <p role="status" className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-3 text-sm">
        Si ese email tiene una cuenta, te enviamos un enlace para cambiar la contraseña. Vale 1 hora. Revisa también la carpeta de spam.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm text-[var(--ink-muted)]">
        Email
        <input type="email" name="email" required autoComplete="email" className="field" />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-[var(--accent-2)]">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-accent">
        {pending ? "Enviando…" : "Enviarme el enlace"}
      </button>
    </form>
  );
}
