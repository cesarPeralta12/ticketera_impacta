"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { formatCode, formatMoney, formatTime } from "@ticketera/core";
import { lookupConsumptionAction, readVoucherAction, type ConsumptionView } from "@/lib/actions/nightlife";

/**
 * Terminal de barra: se lee el QR de consumo (lector USB o código escrito), se ve de quién es y cuánto consumo tiene,
 * y se marca como leído. Es de un solo uso: la próxima vez que se lea dirá «ya fue leído». Quien atiende anota el
 * detalle (la nota es opcional).
 */
export function BarTerminal({ sessionId, timeZone, readOnly = false }: { sessionId: string; timeZone: string; readOnly?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState<{ raw: string; view: ConsumptionView; justRead: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);

  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = code.trim();
    if (!raw) return;
    setError(null);
    startTransition(async () => {
      const result = await lookupConsumptionAction(sessionId, raw);
      if (result.ok) {
        setCurrent({ raw, view: result.view, justRead: false });
        setNote("");
      } else {
        setCurrent(null);
        setError(result.error);
      }
      setCode("");
    });
  }

  function markRead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    setError(null);
    startTransition(async () => {
      const result = await readVoucherAction(sessionId, current.raw, note);
      if (result.ok) {
        setCurrent({ raw: current.raw, view: result.view, justRead: result.justRead });
        setNote("");
        router.refresh();
        codeRef.current?.focus();
      } else {
        setError(result.error);
      }
    });
  }

  const v = current?.view;
  const readAt = v?.redeemedAt ? formatTime(new Date(v.redeemedAt), timeZone) : null;

  return (
    <section className="card space-y-4 p-6">
      <form onSubmit={lookup} className="flex flex-wrap items-end gap-3">
        <label className="label grow">
          QR de consumo o su código
          <input
            ref={codeRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            autoComplete="off"
            placeholder="Lector USB o código (ej. K7Q3M-XPA2B)"
            className="field font-mono"
          />
        </label>
        <button type="submit" disabled={pending || !code.trim()} className="btn btn-primary">
          {pending && !current ? "Buscando…" : "Ver consumo"}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-md bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      {v && (
        <div className="space-y-4 rounded-lg border border-[var(--border)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{v.label}</p>
              <p className="text-sm text-[var(--ink-muted)]">
                {v.kind === "TABLE" ? `${v.people} personas · ` : ""}a nombre de {v.buyer} · orden {formatCode(v.orderCode)}
              </p>
            </div>
            <div className="text-right">
              <p className="eyebrow">Consumo</p>
              <p className="font-mono text-3xl font-semibold text-[var(--success)]">{formatMoney(v.amount, v.currency)}</p>
            </div>
          </div>

          {v.cancelled ? (
            <p className="rounded-md bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger)]">Esa compra está anulada: su consumo no vale.</p>
          ) : v.redeemedAt ? (
            current?.justRead ? (
              <p className="rounded-md bg-[var(--success-soft)] px-4 py-3 text-sm font-medium text-[var(--success)]">
                Leído y marcado. Anota: {v.label} · {formatMoney(v.amount, v.currency)}
                {v.note ? ` · ${v.note}` : ""}.
              </p>
            ) : (
              <p role="alert" className="rounded-md bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger)]">
                YA FUE LEÍDO a las {readAt}
                {v.redeemedBy ? ` por ${v.redeemedBy}` : ""}
                {v.note ? ` · ${v.note}` : ""}. No se puede usar de nuevo.
              </p>
            )
          ) : readOnly ? (
            <p className="text-sm text-[var(--ink-muted)]">Cuenta de solo lectura: el consumo lo marca el personal de la barra.</p>
          ) : (
            <form onSubmit={markRead} className="flex flex-wrap items-end gap-3">
              <label className="label grow">
                Detalle (opcional)
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="ej. 1 botella + 6 vasos" className="field" />
              </label>
              <button type="submit" disabled={pending} className="btn btn-dark">
                {pending ? "Marcando…" : "Marcar como leído"}
              </button>
              <p className="basis-full text-xs text-[var(--ink-dim)]">Al marcarlo, este QR ya no se puede usar otra vez. Anota la mesa y el monto.</p>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
