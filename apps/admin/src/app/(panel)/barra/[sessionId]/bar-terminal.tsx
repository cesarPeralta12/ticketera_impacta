"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { formatCode, formatMoney, formatTime } from "@ticketera/core";
import { lookupConsumptionAction, redeemConsumptionAction, type ConsumptionView } from "@/lib/actions/nightlife";

const QUICK = ["25", "50", "100", "200"];

/**
 * Terminal de barra: se lee el QR (lector USB o código escrito) de cualquier persona de la mesa, se ve su
 * saldo y se descuenta lo que piden.
 */
export function BarTerminal({ sessionId, timeZone, readOnly = false }: { sessionId: string; timeZone: string; readOnly?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState<{ raw: string; view: ConsumptionView } | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);

  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = code.trim();
    if (!raw) return;
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await lookupConsumptionAction(sessionId, raw);
      if (result.ok) {
        setCurrent({ raw, view: result.view });
        setAmount("");
        setNote("");
      } else {
        setCurrent(null);
        setError(result.error);
      }
      setCode("");
    });
  }

  function charge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await redeemConsumptionAction(sessionId, current.raw, amount, note);
      if (result.ok) {
        setCurrent({ raw: current.raw, view: result.view });
        setDone(`Cobrado ${formatMoney(result.charged ?? 0, result.view.currency)}. Saldo: ${formatMoney(result.view.left, result.view.currency)}.`);
        setAmount("");
        setNote("");
        router.refresh();
        codeRef.current?.focus();
      } else {
        setError(result.error);
      }
    });
  }

  const v = current?.view;
  const pct = v && v.amount > 0 ? Math.round((v.spent / v.amount) * 100) : 0;

  return (
    <section className="card space-y-4 p-6">
      <form onSubmit={lookup} className="flex flex-wrap items-end gap-3">
        <label className="label grow">
          QR o código de la entrada
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
        <button type="submit" disabled={pending || !code.trim()} className="btn btn-dark">
          {pending && !current ? "Buscando…" : "Ver saldo"}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-md bg-[var(--danger-soft,#fdecec)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-md bg-[var(--success-soft)] px-3 py-2 text-sm font-medium text-[var(--success)]">
          {done}
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
              <p className="eyebrow">Saldo</p>
              <p className={`font-mono text-2xl font-semibold ${v.left === 0 ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>
                {formatMoney(v.left, v.currency)}
              </p>
              <p className="text-xs text-[var(--ink-dim)]">
                de {formatMoney(v.amount, v.currency)} · consumido {formatMoney(v.spent, v.currency)}
              </p>
            </div>
          </div>
          {v.amount > 0 && (
            <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
            </div>
          )}

          {readOnly ? (
            <p className="text-sm text-[var(--ink-muted)]">Cuenta de solo lectura: el consumo lo descuenta el cajero de la barra.</p>
          ) : v.amount === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Esta mesa no tiene consumo incluido: lo que pidan se cobra aparte.</p>
          ) : v.left === 0 ? (
            <p className="text-sm font-medium text-[var(--danger)]">Saldo agotado: lo que pidan ahora se cobra aparte.</p>
          ) : (
            <form onSubmit={charge} className="flex flex-wrap items-end gap-3">
              <label className="label">
                Monto a descontar (Bs)
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="ej. 120"
                  className="field w-32 font-mono"
                  aria-label="Monto a descontar"
                />
              </label>
              <div className="flex gap-1">
                {QUICK.map((q) => (
                  <button key={q} type="button" onClick={() => setAmount(q)} className="btn px-2 py-1 text-xs">
                    Bs {q}
                  </button>
                ))}
              </div>
              <label className="label grow">
                Detalle (opcional)
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ej. 1 botella + 6 vasos" className="field" />
              </label>
              <button type="submit" disabled={pending || !amount.trim()} className="btn btn-dark">
                {pending ? "Cobrando…" : "Descontar"}
              </button>
            </form>
          )}

          <details>
            <summary className="cursor-pointer text-sm text-[var(--accent)]">
              {v.kind === "TABLE" ? `QR de la mesa (${v.tickets.length})` : "La entrada"} y consumos
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <ul className="space-y-1 text-sm">
                {v.tickets.map((t, i) => (
                  <li key={t.code} className="flex justify-between gap-2">
                    <span>
                      {v.kind === "TABLE" ? `Persona ${i + 1}` : "Entrada"} · {t.holderName ?? "—"}
                    </span>
                    <span className="font-mono text-xs text-[var(--ink-dim)]">
                      {formatCode(t.code)} · {t.status === "USED" ? "adentro" : t.status === "VALID" ? "no llegó" : "anulada"}
                    </span>
                  </li>
                ))}
              </ul>
              <ul className="space-y-1 text-sm">
                {v.redemptions.length === 0 ? (
                  <li className="text-[var(--ink-dim)]">Todavía no consumieron nada.</li>
                ) : (
                  v.redemptions.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <span>
                        {formatTime(new Date(r.at), timeZone)} · {r.staff}
                        {r.note && <span className="text-[var(--ink-dim)]"> · {r.note}</span>}
                      </span>
                      <span className="font-mono">−{formatMoney(r.amount, v.currency)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
