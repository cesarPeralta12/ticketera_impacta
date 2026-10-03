import { formatDateTime, formatMoney } from "@ticketera/core";
import type { EventReport as Report } from "@ticketera/db";
import { CHANNEL_LABEL, SCAN_LABEL } from "@/lib/labels";

const POS_METHOD: Record<string, string> = { efectivo: "Efectivo", qr: "QR", tarjeta: "Tarjeta" };

/** ¿Ya pasaron todas las funciones? Entonces los que no entraron son ausentes. */
function finished(report: Report) {
  const last = report.sessions.at(-1);
  return last ? Date.now() > (last.endsAt ?? last.startsAt).getTime() : false;
}

const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : "—");

/** Reporte de un evento: ventas por canal, ingresos, ausentes, rechazos en puerta y boletería. */
export function EventReport({ report, csvHref }: { report: Report; csvHref: string }) {
  const money = (amount: number) => formatMoney(amount, report.currency);
  const done = finished(report);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Entradas emitidas", String(report.issued)],
          ["Ingresaron", `${report.used} (${pct(report.used, report.issued)})`],
          [done ? "Ausentes" : "Aún no ingresan", String(report.absent)],
          ["Recaudación", money(report.revenue)],
          ["Compras online", String(report.onlineBuyers)],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="eyebrow">{label}</p>
            <p className="font-mono text-xl">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="eyebrow mb-3">Por canal</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-[var(--border)]">
              {report.byChannel.map((c) => (
                <tr key={c.channel}>
                  <td className="py-2">{CHANNEL_LABEL[c.channel]}</td>
                  <td className="py-2 text-right font-mono">{c.tickets} entradas</td>
                  <td className="py-2 text-right font-mono">{money(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card p-5">
          <h2 className="eyebrow mb-3">Asistencia por función</h2>
          {report.sessions.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Sin funciones.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[var(--border)]">
                {report.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2">
                      <span className="font-mono text-xs">{formatDateTime(s.startsAt, s.venue.timezone)}</span>
                      <span className="block text-xs text-[var(--ink-dim)]">{s.venue.name}</span>
                    </td>
                    <td className="py-2 text-right font-mono">
                      {s.used} / {s.issued}
                    </td>
                    <td className="py-2 text-right font-mono text-[var(--ink-muted)]">{pct(s.used, s.issued)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card p-5">
          <h2 className="eyebrow mb-3">Rechazos en puerta</h2>
          {report.rejected.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Ningún rechazo registrado.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[var(--border)]">
                {report.rejected.map((r) => (
                  <tr key={r.result}>
                    <td className="py-2">{SCAN_LABEL[r.result]}</td>
                    <td className="py-2 text-right font-mono">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-[var(--ink-dim)]">
            Intentos de entrar con una entrada ya usada, anulada, de otra función, por la puerta equivocada o con un QR
            que no es del sistema.
          </p>
        </section>

        <section className="card p-5">
          <h2 className="eyebrow mb-3">Boletería</h2>
          {report.pos.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Sin ventas en boletería.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="eyebrow">
                <tr>
                  <th className="pb-1 text-left font-normal">Cajero</th>
                  <th className="pb-1 text-left font-normal">Medio</th>
                  <th className="pb-1 text-right font-normal">Entradas</th>
                  <th className="pb-1 text-right font-normal">Cobrado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {report.pos.map((p) => (
                  <tr key={`${p.cashier}-${p.method}`}>
                    <td className="py-2">{p.cashier}</td>
                    <td className="py-2">{POS_METHOD[p.method] ?? p.method}</td>
                    <td className="py-2 text-right font-mono">{p.tickets}</td>
                    <td className="py-2 text-right font-mono">{money(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <p className="text-sm print:hidden">
        <a href={csvHref} className="text-[var(--accent)] underline">
          Descargar asistentes (CSV)
        </a>{" "}
        <span className="text-[var(--ink-dim)]">
          — una fila por entrada: quién es, por qué canal, si ingresó y a qué hora. Filtrando “No ingresó” sale la lista
          de ausentes.
        </span>
      </p>
    </div>
  );
}
