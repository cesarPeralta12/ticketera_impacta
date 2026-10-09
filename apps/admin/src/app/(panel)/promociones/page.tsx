import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatMoney, promoLabel } from "@ticketera/core";
import { listPromoCodes, prisma, summarizeByPromoter } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { createPromoAction } from "@/lib/actions/promos";
import { promoState } from "@/lib/promo-state";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Promociones" };

export default async function PromosPage() {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const now = new Date();
  const [rows, events] = await Promise.all([
    listPromoCodes(staff.organization.id, now),
    prisma.event.findMany({
      where: { organizationId: staff.organization.id, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    }),
  ]);
  const currency = staff.organization.currency;
  const promoters = summarizeByPromoter(rows);
  const money = (c: number) => formatMoney(c, currency);

  return (
    <div className="space-y-8">
      <div>
        {staff.viewingAs && <p className="eyebrow">{staff.organization.name}</p>}
        <h1 className="page-title">Promociones</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Códigos de descuento para campañas, influencers o promotores (RRPP). Cada código mide cuántas entradas vendió, cuánto
          descontó y, si tiene promotor, la comisión que le corresponde.
        </p>
      </div>

      {promoters.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">Por promotor (RRPP) · solo ventas pagadas</h2>
          <table className="w-full text-left text-sm">
            <thead className="eyebrow border-b border-[var(--border)]">
              <tr>
                <th className="px-5 py-2 font-normal">Promotor</th>
                <th className="px-3 py-2 text-right font-normal">Códigos</th>
                <th className="px-3 py-2 text-right font-normal">Entradas</th>
                <th className="px-3 py-2 text-right font-normal">Ventas</th>
                <th className="px-3 py-2 text-right font-normal">Descuentos</th>
                <th className="px-5 py-2 text-right font-normal">Comisión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {promoters.map((p) => (
                <tr key={p.promoter}>
                  <td className="px-5 py-2.5 font-medium">{p.promoter}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{p.codes}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{p.tickets}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{money(p.sales)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[var(--ink-muted)]">{money(p.discount)}</td>
                  <td className="px-5 py-2.5 text-right font-mono font-semibold">{money(p.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card overflow-x-auto">
        <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">Códigos ({rows.length})</h2>
        {rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">Todavía no hay códigos. Crea el primero aquí abajo.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="eyebrow border-b border-[var(--border)]">
              <tr>
                <th className="px-5 py-2 font-normal">Código</th>
                <th className="px-3 py-2 font-normal">Descuento</th>
                <th className="px-3 py-2 font-normal">Aplica a</th>
                <th className="px-3 py-2 text-right font-normal">Usos</th>
                <th className="px-3 py-2 text-right font-normal">Ventas</th>
                <th className="px-3 py-2 font-normal">Promotor</th>
                <th className="px-5 py-2 font-normal">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((p) => {
                const state = promoState(p, now);
                return (
                  <tr key={p.id}>
                    <td className="px-5 py-2.5">
                      <Link href={`/promociones/${p.id}`} className="font-mono font-semibold text-[var(--accent)] hover:underline">
                        {p.code}
                      </Link>
                      {p.description && <p className="text-xs text-[var(--ink-dim)]">{p.description}</p>}
                    </td>
                    <td className="px-3 py-2.5">{promoLabel(p, money)}</td>
                    <td className="px-3 py-2.5 text-[var(--ink-muted)]">{p.event?.title ?? "Todos los eventos"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {p.uses}
                      {p.maxUses !== null ? ` / ${p.maxUses}` : ""}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">{money(p.sales)}</td>
                    <td className="px-3 py-2.5 text-[var(--ink-muted)]">
                      {p.promoterName ?? "—"}
                      {p.commissionPercent ? ` (${p.commissionPercent}%)` : ""}
                    </td>
                    <td className="px-5 py-2.5">
                      <span className={`badge ${state.className}`}>{state.text}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-6">
        <h2 className="eyebrow mb-4">Nuevo código</h2>
        <ActionForm action={createPromoAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="label">
            Código (vacío = se genera uno)
            <input name="code" placeholder="RRPP-LUIS" autoComplete="off" className="field font-mono uppercase" />
          </label>
          <label className="label">
            Aplica a
            <select name="eventId" defaultValue="" className="field">
              <option value="">Todos los eventos</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Tipo de descuento
            <select name="discountType" defaultValue="PERCENT" className="field">
              <option value="PERCENT">Porcentaje (%)</option>
              <option value="FIXED">Monto fijo por entrada (Bs)</option>
            </select>
          </label>
          <label className="label">
            Valor ({"%"} o Bs)
            <input name="discountValue" required inputMode="decimal" placeholder="20" className="field" />
          </label>
          <label className="label">
            Máximo de usos (vacío = sin límite)
            <input name="maxUses" type="number" min={1} className="field" />
          </label>
          <label className="label">
            Máximo por persona
            <input name="maxUsesPerCustomer" type="number" min={1} defaultValue={1} className="field" />
          </label>
          <label className="label">
            Vale desde (opcional)
            <input name="startsAt" type="datetime-local" className="field" />
          </label>
          <label className="label">
            Vale hasta (opcional)
            <input name="endsAt" type="datetime-local" className="field" />
          </label>
          <label className="label">
            Descripción (interna)
            <input name="description" maxLength={200} placeholder="Campaña de lanzamiento" className="field" />
          </label>
          <label className="label">
            Promotor / RRPP (opcional)
            <input name="promoterName" maxLength={80} placeholder="Luis Vargas" className="field" />
          </label>
          <label className="label">
            Comisión del promotor (%)
            <input name="commissionPercent" type="number" min={0} max={100} className="field" />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="combinableWithPresale" className="h-4 w-4 accent-[var(--accent)]" />
            Se puede sumar al precio de preventa
          </label>
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <button type="submit" className="btn btn-primary">
              Crear código
            </button>
          </div>
        </ActionForm>
        <p className="mt-3 text-xs text-[var(--ink-dim)]">
          Por defecto el código no se suma a la preventa: las entradas que ya tienen precio de preventa quedan fuera del
          descuento. Las fechas son hora de La Paz. El código y el descuento no se editan una vez creados (cambiarlos a mitad de
          campaña descuadra los reportes): si hay que cambiarlos, desactívalo y crea otro.
        </p>
      </section>
    </div>
  );
}
