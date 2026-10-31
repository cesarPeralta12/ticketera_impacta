import Link from "next/link";
import { DEFAULT_TIMEZONE, formatCode, formatDateTime, formatMoney } from "@ticketera/core";
import type { paymentDetails } from "@ticketera/db";
import { methodName } from "@/lib/sales";

export type PaymentRow = Awaited<ReturnType<typeof paymentDetails>>["rows"][number];

/** Quién cobró: el cajero, el promotor o el cliente mismo en la web. */
const seller = (o: PaymentRow["order"]) => o.issuedBy?.name ?? (o.promoter ? `${o.promoter.name} (promotor)` : o.channel === "ONLINE" ? "El cliente, en la web" : o.channel);

/**
 * Tabla de cobros con quién compró, qué, quién lo cobró y por cuánto. `showMedium` agrega el medio y la referencia
 * (se omite cuando la tabla ya está dentro de un día y medio).
 */
export function PaymentTable({ rows, global, showMedium = true }: { rows: PaymentRow[]; global: boolean; showMedium?: boolean }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="eyebrow border-b border-[var(--border)]">
        <tr>
          <th className="px-5 py-2 font-normal">Cobrado</th>
          <th className="px-3 py-2 font-normal">Orden</th>
          <th className="px-3 py-2 font-normal">Comprador</th>
          <th className="px-3 py-2 font-normal">Qué compró</th>
          {showMedium && <th className="px-3 py-2 font-normal">Medio · referencia</th>}
          <th className="px-3 py-2 font-normal">Lo cobró</th>
          <th className="px-3 py-2 text-right font-normal">Monto</th>
          <th className="px-5 py-2 font-normal">Estado</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border)]">
        {rows.map((p) => (
          <tr key={p.id} className="align-top">
            <td className="px-5 py-2.5 font-mono text-xs">{p.approvedAt ? formatDateTime(p.approvedAt, DEFAULT_TIMEZONE) : "—"}</td>
            <td className="px-3 py-2.5">
              <Link href={`/ordenes/${p.order.code}`} className="font-mono underline">
                {formatCode(p.order.code)}
              </Link>
              <span className="block text-xs text-[var(--ink-dim)]">{p.order.channel === "ONLINE" ? "web" : p.order.channel === "POS" ? "boletería" : p.order.channel.toLowerCase()}</span>
            </td>
            <td className="px-3 py-2.5">
              <span className="block font-medium">{p.order.buyerName}</span>
              <span className="block text-xs text-[var(--ink-dim)]">{[p.order.buyerDocument, p.order.buyerEmail].filter(Boolean).join(" · ")}</span>
            </td>
            <td className="px-3 py-2.5 text-xs">
              {p.order.items.map((i, n) => (
                <span key={n} className="block">
                  {i.quantity} × {i.ticketType.name} <span className="text-[var(--ink-dim)]">({formatMoney(i.unitAmount, p.currency)} c/u)</span>
                  <span className="block text-[var(--ink-dim)]">
                    {i.ticketType.session.event.title}
                    {global ? ` · ${i.ticketType.session.event.organization.name}` : ""}
                  </span>
                </span>
              ))}
              {p.order.promoRedemption && (
                <span className="block text-[var(--success)]">
                  código {p.order.promoRedemption.promoCode.code}
                  {p.order.discountAmount > 0 ? ` · −${formatMoney(p.order.discountAmount, p.currency)}` : ""}
                </span>
              )}
            </td>
            {showMedium && (
              <td className="px-3 py-2.5">
                {methodName(p.provider)}
                <span className="block font-mono text-xs text-[var(--ink-dim)]">{p.providerPaymentId ?? "sin referencia"}</span>
              </td>
            )}
            <td className="px-3 py-2.5">{seller(p.order)}</td>
            <td className="px-3 py-2.5 text-right font-mono font-semibold">
              {formatMoney(p.amount, p.currency)}
              {p.order.totalAmount !== p.amount && <span className="block text-xs font-normal text-[var(--warn)]">la orden es de {formatMoney(p.order.totalAmount, p.currency)}</span>}
            </td>
            <td className="px-5 py-2.5">
              <span className={`badge ${p.status === "REFUNDED" ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--success-soft)] text-[var(--success)]"}`}>{p.status === "REFUNDED" ? "Devuelto" : "Cobrado"}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
