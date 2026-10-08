"use client";

import { useActionState } from "react";
import { forgotPasswordAction } from "./actions";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, undefined);
  if (state?.sent) {
    return (
      <p role="status" className="rounded-md bg-[var(--accent-soft)] px-3 py-2.5 text-sm text-[var(--accent)]">
        Si ese email tiene una cuenta, te enviamos un enlace para cambiar la contraseña. Vale 1 hora. Revisa también la carpeta de spam.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="label">
        Email
        <input type="email" name="email" required autoComplete="username" className="field" />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Enviando…" : "Enviarme el enlace"}
      </button>
    </form>
  );
}
