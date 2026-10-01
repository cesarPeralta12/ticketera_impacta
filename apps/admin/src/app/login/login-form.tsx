"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? "/"} />
      <label className="label">
        Email
        <input type="email" name="email" required autoComplete="username" className="field" />
      </label>
      <label className="label">
        Contraseña
        <input type="password" name="password" required autoComplete="current-password" className="field" />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary mt-1">
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
