"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "./actions";

export function ResetForm({ token, minLength }: { token: string; minLength: number }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <label className="label">
        Contraseña nueva (mínimo {minLength})
        <input type="password" name="password" required minLength={minLength} autoComplete="new-password" className="field" />
      </label>
      <label className="label">
        Repite la contraseña
        <input type="password" name="repeat" required minLength={minLength} autoComplete="new-password" className="field" />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Guardando…" : "Guardar contraseña"}
      </button>
    </form>
  );
}
