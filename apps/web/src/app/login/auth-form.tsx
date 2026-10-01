"use client";

import { useActionState } from "react";
import { MIN_PASSWORD_LENGTH } from "@ticketera/core";
import { loginAction, registerAction } from "./actions";

/** Formularios de ingreso y registro (prototipo del compañero, con su estilo). */
export function AuthForm({ mode, next }: { mode: "login" | "register"; next?: string }) {
  const [state, formAction, pending] = useActionState(mode === "login" ? loginAction : registerAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      {mode === "register" && (
        <label className="flex flex-col gap-1.5 text-sm text-[var(--ink-muted)]">
          Nombre
          <input name="name" required autoComplete="name" className="field" />
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm text-[var(--ink-muted)]">
        Email
        <input type="email" name="email" required autoComplete="email" className="field" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-[var(--ink-muted)]">
        Contraseña
        <input
          type="password"
          name="password"
          required
          minLength={mode === "register" ? MIN_PASSWORD_LENGTH : undefined}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          className="field"
        />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-[var(--accent-2)]">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-accent mt-1">
        {pending ? "Un momento…" : mode === "login" ? "Ingresar" : "Crear cuenta"}
      </button>
    </form>
  );
}
