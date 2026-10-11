"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { transferTicketAction, type TransferState } from "./actions";

/** "Transferir": email de la otra cuenta y confirmación (no se puede deshacer). */
export function TransferForm({ ticketId, label }: { ticketId: string; label: string }) {
  const [state, formAction] = useActionState<TransferState, FormData>(transferTicketAction, undefined);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    if (!window.confirm(`¿Transferir ${label} a ${email}? Tu QR deja de valer y no se puede deshacer.`)) return;
    startTransition(() => formAction(data));
  }

  if (state?.done) return <p className="text-xs font-semibold text-[#1d7a4f]">{state.done}</p>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-[#6b4ad6] underline">
        Transferir a otra persona
      </button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2 text-left">
      <input type="hidden" name="ticketId" value={ticketId} />
      <label className="block text-xs text-[#6b687a]">
        Email de su cuenta en Impacta
        <input
          name="email"
          type="email"
          required
          autoComplete="off"
          className="mt-1 block w-full rounded-md border border-[#d9d6cf] bg-white px-2 py-1.5 text-sm text-[#14181b]"
        />
      </label>
      <p className="text-[11px] leading-snug text-[#6b687a]">
        La persona tiene que estar registrada. Recibe la entrada con un QR nuevo; el tuyo deja de valer.
      </p>
      {state?.error && <p className="text-xs font-semibold text-[#c2183e]">{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-md bg-[#14181b] px-3 py-1.5 text-xs font-semibold text-white">
          {pending ? "Transfiriendo…" : "Transferir"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-[#6b687a]">
          Cancelar
        </button>
      </div>
    </form>
  );
}
