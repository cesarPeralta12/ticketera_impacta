"use client";

import { useActionState } from "react";
import { formatMoney } from "@ticketera/core";
import { compareProviderReportAction, type ComparisonState } from "@/lib/actions/reconciliation";

/** Pegar el reporte de la pasarela y ver las diferencias contra lo que el sistema dio por cobrado. */
export function CompareForm({ from, to, currency }: { from: string; to: string; currency: string }) {
  const [state, action, pending] = useActionState<ComparisonState, FormData>(compareProviderReportAction, undefined);
  const money = (c: number) => formatMoney(c, currency);
  const result = state?.result;
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="desde" value={from} />
        <input type="hidden" name="hasta" value={to} />
        <label className="label">
          Pasarela (como figura en los pagos)
          <input name="proveedor" required placeholder="ej. bnb" className="field" />
        </label>
        <label className="label sm:col-span-2">
          Reporte de la pasarela (una línea por cobro: referencia;monto)
          <textarea name="reporte" required rows={4} placeholder={"ABC123;150,00\nABC124;80,00"} className="field font-mono text-xs" />
        </label>
        <button type="submit" disabled={pending} className="btn w-fit">
          {pending ? "Comparando…" : "Comparar"}
        </button>
      </form>
      {state?.error && <p className="text-sm text-[var(--danger)]">{state.error}</p>}
      {result && (
        <div className="space-y-3 text-sm">
          <p>
            <strong className="text-[var(--success)]">{result.matched}</strong> cobro(s) coinciden.
            {result.skipped > 0 && <span className="text-[var(--ink-dim)]"> ({result.skipped} línea(s) sin monto se saltaron, por ejemplo los títulos.)</span>}
          </p>
          {result.amountMismatch.length > 0 && (
            <div>
              <p className="font-semibold text-[var(--danger)]">Montos distintos</p>
              <ul className="list-disc pl-5">
                {result.amountMismatch.map((m) => (
                  <li key={m.reference}>
                    {m.reference} (orden {m.order}): sistema {money(m.system)} · pasarela {money(m.report)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.missingInSystem.length > 0 && (
            <div>
              <p className="font-semibold text-[var(--danger)]">En la pasarela pero no en el sistema</p>
              <ul className="list-disc pl-5">
                {result.missingInSystem.map((r) => (
                  <li key={r.reference}>
                    {r.reference}: {money(r.amount)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.missingInReport.length > 0 && (
            <div>
              <p className="font-semibold text-[var(--warn)]">En el sistema pero no en el reporte</p>
              <ul className="list-disc pl-5">
                {result.missingInReport.map((p) => (
                  <li key={`${p.order}-${p.reference}`}>
                    Orden {p.order} · ref. {p.reference ?? "—"} · {money(p.amount)} · {p.at}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.amountMismatch.length === 0 && result.missingInSystem.length === 0 && result.missingInReport.length === 0 && (
            <p className="font-semibold text-[var(--success)]">Todo coincide.</p>
          )}
        </div>
      )}
    </div>
  );
}
