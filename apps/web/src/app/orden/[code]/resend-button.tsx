"use client";

import { useActionState } from "react";
import { resendTicketsAction } from "./actions";

export function ResendTickets({ code }: { code: string }) {
  const [state, formAction, pending] = useActionState(resendTicketsAction, undefined);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-center gap-3">
      <input type="hidden" name="code" value={code} />
      <button type="submit" disabled={pending} className="rounded-full border border-[var(--border-light)] px-4 py-1.5 text-sm font-semibold hover:bg-white/5 disabled:opacity-50">
        {pending ? "Enviando…" : "Reenviar a mi correo"}
      </button>
      {state?.message && <span className="text-sm text-[var(--green)]">{state.message}</span>}
      {state?.error && <span className="text-sm text-[var(--accent-2)]">{state.error}</span>}
    </form>
  );
}
