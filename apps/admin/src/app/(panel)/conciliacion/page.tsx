import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, formatCode, formatDateTime, formatMoney, utcToZonedInput, zonedDateTimeToUtc } from "@ticketera/core";
import { paymentReconciliation } from "@ticketera/db";
import { Help } from "@/components/help";
import { methodName } from "@/lib/sales";
import { ROLES, isGlobalView, requireStaff } from "@/lib/session";
import { CompareForm } from "./compare-form";

export const metadata: Metadata = { title: "Conciliación" };

type Props = { searchParams: Promise<{ desde?: string; hasta?: string }> };

const isDay = (v: string | undefined): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
const shift = (d: string, days: number) => {
  const date = new Date(`${d}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Conciliación de cobros: lo que el sistema dio por cobrado cada día y por medio, lo que hay que revisar (pagos sin
 * entradas, cobros dobles, ventas sin pago, cobros QR abandonados, devoluciones) y la comparación contra el reporte de
 * la pasarela.
 */
export default async function ReconciliationPage({ searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const params = await searchParams;
  const today = utcToZonedInput(new Date(), DEFAULT_TIMEZONE).slice(0, 10);
  const to = isDay(params.hasta) ? params.hasta : today;
  const from = isDay(params.desde) ? params.desde : shift(to, -6);
  const data = await paymentReconciliation({
    organizationId: isGlobalView(staff) ? null : staff.organization.id,
    from: zonedDateTimeToUtc(`${from}T00:00`, DEFAULT_TIMEZONE),
    to: zonedDateTimeToUtc(`${shift(to, 1)}T00:00`, DEFAULT_TIMEZONE),
  });
  const currency = staff.organization.currency;
  const money = (c: number) => formatMoney(c, currency);
  const issues = data.issues;
  const problems = issues.approvedWithoutTickets.length + issues.doubles.length + issues.paidWithoutPayment.length;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{isGlobalView(staff) ? "Todos los organizadores" : staff.organization.name}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          Conciliación de cobros
          <Help title="Conciliación">
            Cada día, compara lo que el sistema dio por cobrado con lo que llegó al banco o a la pasarela. El efectivo y el QR de caja los declara el cajero;
            el QR de pasarela lo confirma el banco. Pega el reporte de la pasarela abajo para ver las diferencias.
          </Help>
        </h1>
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4">
        <label className="label">
          Desde
          <input type="date" name="desde" defaultValue={from} className="field" />
        </label>
        <label className="label">
          Hasta
          <input type="date" name="hasta" defaultValue={to} className="field" />
        </label>
        <button type="submit" className="btn">
          Ver
        </button>
      </form>

      <section className="card overflow-x-auto">
        <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">
          Cobrado por día y medio · total {money(data.totals.amount)} ({data.totals.count} pago(s))
        </h2>
        {data.byDay.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">Sin cobros en el período.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-[var(--border)]">
              {data.byDay.map((r) => (
                <tr key={`${r.day}-${r.provider}`}>
                  <td className="px-5 py-2 font-mono">{r.day}</td>
                  <td className="px-5 py-2">{methodName(r.provider)}</td>
                  <td className="px-5 py-2 text-right">{r.count}</td>
                  <td className="px-5 py-2 text-right font-mono">{formatMoney(r.amount, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="eyebrow">Para revisar {problems > 0 ? <span className="text-[var(--danger)]">· {problems}</span> : <span className="text-[var(--success)]">· todo en orden</span>}</h2>
        {[
          {
            title: "Pago aprobado sin entradas (hay que devolver el dinero)",
            rows: issues.approvedWithoutTickets.map((p) => ({ code: p.order.code, text: `${methodName(p.provider)} · ref. ${p.providerPaymentId ?? "—"} · ${money(p.amount)} · orden ${p.order.status}` })),
          },
          {
            title: "Venta pagada dos veces",
            rows: issues.doubles.map((o) => ({ code: o.code, text: `${o.payments.length} pagos aprobados · ${money(o.payments.reduce((s, p) => s + p.amount, 0))}` })),
          },
          {
            title: "Venta pagada sin ningún pago aprobado",
            rows: issues.paidWithoutPayment.map((o) => ({ code: o.code, text: `${o.buyerName} · ${money(o.totalAmount)}` })),
          },
          {
            title: "Anuladas del período (si se había cobrado, revisar si hay que devolver)",
            rows: issues.voided.map((o) => ({
              code: o.code,
              text: `${o.buyerName} · ${money(o.totalAmount)}${o.payments.length ? ` · cobrado por ${methodName(o.payments[0]!.provider)}` : ""}${o.voidReason ? ` · ${o.voidReason}` : ""}`,
            })),
          },
          {
            title: "Devoluciones del período",
            rows: issues.refunded.map((p) => ({ code: p.order.code, text: `${methodName(p.provider)} · ${money(p.amount)}${p.order.voidReason ? ` · ${p.order.voidReason}` : ""}` })),
          },
          {
            title: "Cobros QR abandonados (no son dinero, solo para saber)",
            rows: issues.abandoned.map((p) => ({ code: p.order.code, text: `${methodName(p.provider)} · ${money(p.amount)} · ${formatDateTime(p.createdAt, DEFAULT_TIMEZONE)}` })),
          },
        ].map((block) => (
          <div key={block.title}>
            <p className="text-sm font-semibold">
              {block.title} <span className="font-normal text-[var(--ink-dim)]">({block.rows.length})</span>
            </p>
            {block.rows.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sm">
                {block.rows.map((r, i) => (
                  <li key={`${r.code}-${i}`}>
                    <Link href={`/ordenes/${r.code}`} className="font-mono underline">
                      {formatCode(r.code)}
                    </Link>{" "}
                    · {r.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="eyebrow mb-3">Comparar con el reporte de la pasarela</h2>
        <CompareForm from={from} to={to} currency={currency} />
      </section>
    </div>
  );
}
