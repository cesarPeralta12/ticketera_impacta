"use client";

import { useActionState } from "react";
import { offerTicketAction } from "./actions";

/** Formulario para ofrecer una entrada a otra persona registrada (por email o carnet). */
export function TransferForm({ ticketId }: { ticketId: string }) {
  const [state, formAction, pending] = useActionState(offerTicketAction, undefined);
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 text-left">
      <input type="hidden" name="ticketId" value={ticketId} />
      <label className="text-xs text-[#60718B]">
        Email o carnet de la persona (debe tener cuenta en iPass)
        <input name="recipient" required autoComplete="off" placeholder="amigo@correo.com o 1234567" className="mt-1 w-full rounded-lg border border-[#E6EAF0] bg-white px-3 py-2 text-sm text-[#192438]" />
      </label>
      {state?.error && (
        <p role="alert" className="text-xs font-semibold text-[#C62842]">
          {state.error}
        </p>
      )}
      {state?.message && <p className="text-xs font-semibold text-[#16846C]">{state.message}</p>}
      <button type="submit" disabled={pending} className="rounded-lg bg-[#192438] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Enviando…" : "Ofrecer la entrada"}
      </button>
      <p className="text-[11px] leading-snug text-[#60718B]">
        Ella la acepta y entonces pasa a su cuenta con su nombre y su carnet; tu QR deja de valer. Hasta que la acepte, la entrada sigue siendo tuya.
      </p>
    </form>
  );
}
