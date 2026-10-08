"use client";

import { useActionState } from "react";
import { confirmEmailAction, resendVerificationAction } from "./actions";

export function ConfirmForm({ token, next }: { token: string; next?: string }) {
  const [state, formAction, pending] = useActionState(confirmEmailAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="next" value={next ?? ""} />
      {state?.error && (
        <p role="alert" className="text-sm text-[var(--accent-2)]">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-accent">
        {pending ? "Confirmando…" : "Confirmar mi correo"}
      </button>
    </form>
  );
}

export function ResendForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(resendVerificationAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next ?? ""} />
      {state?.error && (
        <p role="alert" className="text-sm text-[var(--accent-2)]">
          {state.error}
        </p>
      )}
      {state?.message && <p className="text-sm text-[var(--accent)]">{state.message}</p>}
      <button type="submit" disabled={pending} className="btn-accent">
        {pending ? "Enviando…" : "Reenviar el correo"}
      </button>
    </form>
  );
}
