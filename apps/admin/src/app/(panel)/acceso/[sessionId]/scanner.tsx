"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { formatCode, formatTime } from "@ticketera/core";
import { scanAction, type ScanState } from "./actions";

const resultView = {
  ACCEPTED: { title: "Acceso permitido", className: "bg-emerald-600 text-white" },
  ALREADY_USED: { title: "Entrada ya utilizada", className: "bg-red-600 text-white" },
  NOT_FOUND: { title: "La entrada no existe", className: "bg-red-600 text-white" },
  CANCELLED: { title: "Entrada anulada", className: "bg-red-600 text-white" },
  WRONG_SESSION: { title: "Entrada de otra función", className: "bg-amber-500 text-white" },
  INVALID: { title: "QR inválido o adulterado", className: "bg-red-600 text-white" },
} as const;

/**
 * Lector de puerta. Funciona con lectores de código de barras USB/Bluetooth (escriben el
 * QR y presionan Enter) y con ingreso manual del código impreso bajo el QR.
 */
export function Scanner({
  sessionId,
  timezone,
  accessPoints,
}: {
  sessionId: string;
  timezone: string;
  accessPoints: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ScanState, FormData>(scanAction, null);
  const [pending, startTransition] = useTransition();
  const [accessPointId, setAccessPointId] = useState(accessPoints[0]?.id ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (state) router.refresh(); // actualiza contadores e historial
  }, [state, router]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (inputRef.current) inputRef.current.value = ""; // listo para la siguiente lectura
    startTransition(() => formAction(data));
  }

  const view = state ? resultView[state.result] : null;

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3 card p-5">
        <input type="hidden" name="sessionId" value={sessionId} />
        <label className="block text-sm">
          <span className="text-[var(--ink)]">Puerta</span>
          <select
            name="accessPointId"
            value={accessPointId}
            onChange={(e) => setAccessPointId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            {accessPoints.map((point) => (
              <option key={point.id} value={point.id}>
                {point.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-[var(--ink)]">Escanea el QR o escribe el código de la entrada</span>
          <div className="mt-1 flex gap-2">
            <input
              ref={inputRef}
              name="raw"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Ej. K7Q3M-XPA2B"
              className="block w-full rounded-lg border border-[var(--border)] px-3 py-2 font-mono"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-[var(--ink)] px-5 py-2 font-medium text-white disabled:bg-zinc-400"
            >
              Validar
            </button>
          </div>
        </label>
      </form>

      {state && view && (
        <div role="status" className={`rounded-xl p-6 ${view.className}`}>
          <p className="text-2xl font-bold">{view.title}</p>
          {state.ticket && (
            <p className="mt-1 opacity-90">
              {state.ticket.ticketType} · {state.ticket.holderName ?? "Sin nombre"} ·{" "}
              <span className="font-mono">{formatCode(state.ticket.code)}</span>
            </p>
          )}
          {state.result === "WRONG_SESSION" && state.ticket && (
            <p className="mt-1 opacity-90">Es para: {state.ticket.event}</p>
          )}
          {state.previousEntry && (
            <p className="mt-1 opacity-90">
              Ingresó a las {formatTime(new Date(state.previousEntry.at), timezone)}
              {state.previousEntry.accessPoint && ` por ${state.previousEntry.accessPoint}`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
