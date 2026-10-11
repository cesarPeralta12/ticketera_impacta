import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, formatDateTime, formatMoney, promoLabel, utcToZonedInput } from "@ticketera/core";
import { getPromoDetail } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { togglePromoAction, updatePromoAction } from "@/lib/actions/promos";
import { ROLES, requireStaff } from "@/lib/session";
import { promoState } from "@/lib/promo-state";

export const metadata: Metadata = { title: "Código promocional" };

type Props = { params: Promise<{ id: string }> };

const ORDER_STATUS: Record<string, string> = {
  PENDING_PAYMENT: "Reservada",
  PAID: "Pagada",
  PARTIALLY_REFUNDED: "Reembolso parcial",
  EXPIRED: "Vencida",
  CANCELLED: "Cancelada",
  REFUNDED: "Reembolsada",
};

export default async function PromoDetailPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id } = await params;
  const now = new Date();
  const detail = await getPromoDetail(staff.organization.id, id, now);
  if (!detail) notFound();
  const { promo, stats, redemptions } = detail;
  const money = (c: number) => formatMoney(c, staff.organization.currency);
  const state = promoState(stats, now);

  const cards = [
    { label: "Usos pagados", value: stats.paidUses },
    { label: "Entradas vendidas", value: stats.tickets },
    { label: "Ventas", value: money(stats.sales) },
    { label: "Descuento dado", value: money(stats.discount) },
    ...(promo.commissionPercent ? [{ label: `Comisión (${promo.commissionPercent}%)`, value: money(stats.commission) }] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/promociones" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Promociones
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{promo.code}</h1>
          <span className={`badge ${state.className}`}>{state.text}</span>
        </div>
        <p className="text-sm text-[var(--ink-muted)]">
          {promoLabel(promo, money)} · {promo.event?.title ?? "todos los eventos"}
          {promo.promoterName ? ` · promotor: ${promo.promoterName}` : ""}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <dt className="eyebrow">{c.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{c.value}</dd>
          </div>
        ))}
      </dl>

      <section className="card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="eyebrow">Límites y promotor</h2>
          <ActionForm action={togglePromoAction} confirm={promo.active ? "¿Desactivar este código? Dejará de funcionar de inmediato." : undefined}>
            <input type="hidden" name="promoId" value={promo.id} />
            <input type="hidden" name="active" value={promo.active ? "false" : "true"} />
            <button type="submit" className={`btn text-xs ${promo.active ? "" : "btn-primary"}`}>
              {promo.active ? "Desactivar" : "Activar"}
            </button>
          </ActionForm>
        </div>
        <ActionForm action={updatePromoAction} successMessage="Guardado." className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="promoId" value={promo.id} />
          <label className="label">
            Máximo de usos
            <input name="maxUses" type="number" min={1} defaultValue={promo.maxUses ?? ""} placeholder="sin límite" className="field" />
          </label>
          <label className="label">
            Máximo por persona
            <input name="maxUsesPerCustomer" type="number" min={1} defaultValue={promo.maxUsesPerCustomer ?? ""} placeholder="sin límite" className="field" />
          </label>
          <label className="label">
            Descripción (interna)
            <input name="description" maxLength={200} defaultValue={promo.description ?? ""} className="field" />
          </label>
          <label className="label">
            Vale desde
            <input name="startsAt" type="datetime-local" defaultValue={promo.startsAt ? utcToZonedInput(promo.startsAt, DEFAULT_TIMEZONE) : ""} className="field" />
          </label>
          <label className="label">
            Vale hasta
            <input name="endsAt" type="datetime-local" defaultValue={promo.endsAt ? utcToZonedInput(promo.endsAt, DEFAULT_TIMEZONE) : ""} className="field" />
          </label>
          <span />
          <label className="label">
            Promotor / RRPP
            <input name="promoterName" maxLength={80} defaultValue={promo.promoterName ?? ""} className="field" />
          </label>
          <label className="label">
            Comisión del promotor (%)
            <input name="commissionPercent" type="number" min={0} max={100} defaultValue={promo.commissionPercent ?? ""} className="field" />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="combinableWithPresale" defaultChecked={promo.combinableWithPresale} className="h-4 w-4 accent-[var(--accent)]" />
            Se puede sumar al precio de preventa
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <button type="submit" className="btn btn-dark">
              Guardar cambios
            </button>
          </div>
        </ActionForm>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">Usos ({redemptions.length})</h2>
        {redemptions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">Todavía nadie usó este código.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="eyebrow border-b border-[var(--border)]">
              <tr>
                <th className="px-5 py-2 font-normal">Fecha</th>
                <th className="px-3 py-2 font-normal">Comprador</th>
                <th className="px-3 py-2 font-normal">Orden</th>
                <th className="px-3 py-2 text-right font-normal">Entradas</th>
                <th className="px-3 py-2 text-right font-normal">Descuento</th>
                <th className="px-3 py-2 text-right font-normal">Total</th>
                <th className="px-5 py-2 font-normal">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {redemptions.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-2 text-xs text-[var(--ink-muted)]">{formatDateTime(r.createdAt, DEFAULT_TIMEZONE)}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.order.buyerName}</span>
                    <span className="block text-xs text-[var(--ink-dim)]">{r.order.buyerEmail}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.order.code}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.order._count.tickets}</td>
                  <td className="px-3 py-2 text-right font-mono">{money(r.discountAmount)}</td>
                  <td className="px-3 py-2 text-right font-mono">{money(r.order.totalAmount)}</td>
                  <td className="px-5 py-2">
                    <span className={`badge ${r.order.status === "PAID" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-2)] text-[var(--ink-dim)]"}`}>
                      {ORDER_STATUS[r.order.status] ?? r.order.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
