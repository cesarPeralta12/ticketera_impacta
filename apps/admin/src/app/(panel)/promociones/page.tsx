import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatMoney, promoLabel } from "@ticketera/core";
import { listPromoCodes, listPromoterAccounts, prisma, summarizeByPromoter } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { FilterForm } from "@/components/filter-form";
import { PAGE_SIZE, Pager, pageFrom } from "@/components/pager";
import { createPromoAction } from "@/lib/actions/promos";
import { promoState } from "@/lib/promo-state";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Promociones" };

export default async function PromosPage({ searchParams }: { searchParams: Promise<{ promotor?: string; q?: string; pagina?: string }> }) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const sp = await searchParams;
  const presetPromoter = sp.promotor ?? "";
  const q = (sp.q ?? "").trim().toLowerCase();
  const now = new Date();
  const [allRows, events, promoterAccounts] = await Promise.all([
    listPromoCodes(staff.organization.id, now),
    prisma.event.findMany({
      where: { organizationId: staff.organization.id, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    }),
    listPromoterAccounts(staff.organization.id),
  ]);
  const matching = q ? allRows.filter((r) => [r.code, r.description, r.promoterName, r.event?.title].some((v) => v?.toLowerCase().includes(q))) : allRows;
  const page = pageFrom(sp.pagina, Math.ceil(matching.length / PAGE_SIZE));
  const rows = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const currency = staff.organization.currency;
  const promoters = summarizeByPromoter(allRows);
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

      <div className="card flex flex-wrap items-center justify-between gap-3 border-[var(--accent)]/40 p-4">
        <p className="text-sm">
          <strong>Promotores con cuenta de venta:</strong> venden con cobro por QR desde su panel, con su código y su comisión por evento.
        </p>
        <span className="flex gap-2">
          <Link href="/promotores" className="btn text-sm">
            Ver promotores
          </Link>
          {staff.canAdminister && (
            <Link href="/promotores#nuevo" className="btn btn-primary text-sm">
              + Nuevo promotor
            </Link>
          )}
        </span>
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

      <FilterForm key={JSON.stringify(sp)}>
        <label className="label grow basis-64">
          Buscar un código
          <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Código, descripción, promotor o evento" className="field" autoComplete="off" />
        </label>
      </FilterForm>

      <section className="card overflow-x-auto">
        <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">Códigos ({matching.length}{q ? ` de ${allRows.length}` : ""})</h2>
        {matching.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">{q ? "Ningún código coincide con la búsqueda." : "Todavía no hay códigos. Crea el primero aquí abajo."}</p>
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
                      {!p.promoterId && p.promoterName && <span className="badge ml-1.5 bg-[var(--warn-soft)] text-[var(--warn)]">sin cuenta</span>}
                      {!p.promoterId && p.commissionPercent ? ` (${p.commissionPercent}%)` : ""}
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

      <Pager path="/promociones" params={{ q: sp.q, promotor: sp.promotor }} page={page} total={matching.length} />

      <section id="nuevo" data-tour="crear-codigo" className="card scroll-mt-6 p-6">
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
            <select name="promoterId" defaultValue={promoterAccounts.some((a) => a.id === presetPromoter) ? presetPromoter : ""} className="field">
              <option value="">Sin promotor</option>
              {promoterAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.email}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--ink-dim)]">
              Solo cuentas de promotor. Lo que se compra con este código suma a su comisión según la regla de su evento.
              ¿No está en la lista? <Link href="/promotores#nuevo" className="underline">Crea su cuenta primero</Link>.
            </span>
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
