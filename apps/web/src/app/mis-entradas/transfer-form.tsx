"use client";

import { useActionState } from "react";
import { offerTicketAction } from "./actions";

/** Formulario para ofrecer una entrada a otra persona registrada (por email o carnet). */
export function TransferForm({ ticketId }: { ticketId: string }) {
  const [state, formAction, pending] = useActionState(offerTicketAction, undefined);
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 text-left">
      <input type="hidden" name="ticketId" value={ticketId} />
      <label className="text-xs text-[#6b687a]">
        Email o carnet de la persona (debe tener cuenta en Impacta)
        <input name="recipient" required autoComplete="off" placeholder="amigo@correo.com o 1234567" className="mt-1 w-full rounded-lg border border-[#d8d5cc] bg-white px-3 py-2 text-sm text-[#14181b]" />
      </label>
      {state?.error && (
        <p role="alert" className="text-xs font-semibold text-[#c2183e]">
          {state.error}
        </p>
      )}
      {state?.message && <p className="text-xs font-semibold text-[#0f8a6b]">{state.message}</p>}
      <button type="submit" disabled={pending} className="rounded-lg bg-[#14181b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Enviando…" : "Ofrecer la entrada"}
      </button>
      <p className="text-[11px] leading-snug text-[#6b687a]">
        Ella la acepta y entonces pasa a su cuenta con su nombre y su carnet; tu QR deja de valer. Hasta que la acepte, la entrada sigue siendo tuya.
      </p>
    </form>
  );
}
