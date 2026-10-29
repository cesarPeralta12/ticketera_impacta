import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { commissionLabel, formatMoney } from "@ticketera/core";
import { MIN_PASSWORD_LENGTH, promotersReport } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { Help } from "@/components/help";
import { PromoterAssignmentFields } from "@/components/promoter-assignment-fields";
import { createPromoterAction } from "@/lib/actions/promoters";
import { pickerEvents } from "@/lib/picker-events";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Promotores" };

/**
 * Los promotores de la organización: qué eventos venden, cuánto vendió cada uno (pagado), su comisión y lo que falta
 * pagarles, en vivo. iPass da de alta un promotor en un solo paso (cuenta, código, evento, comisión y cupo).
 */
export default async function PromotersPage() {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const [promoters, events] = await Promise.all([promotersReport(staff.organization.id), staff.platform ? pickerEvents(staff.organization.id) : []]);
  const money = (c: number) => formatMoney(c, staff.organization.currency);
  const total = promoters.reduce(
    (sum, p) => ({ amount: sum.amount + p.amount, commission: sum.commission + p.commission, toSettle: sum.toSettle + p.toSettle }),
    { amount: 0, commission: 0, toSettle: 0 },
  );

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {staff.viewingAs && <p className="eyebrow">{staff.organization.name}</p>}
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            Promotores
            <Help title="Promotores">
              Cada promotor entra al panel y solo ve «Vender»: los eventos y funciones que le asignas aquí. Cobra siempre por QR (nunca efectivo) y las
              entradas le llegan al cliente por correo y WhatsApp. Su comisión (un % o un monto por entrada, por evento) sube cuando el cliente paga.
              Lo que se compra en la web con su enlace o código también suma. Al pagarle, «Liquidar» marca esas ventas como pagadas.
            </Help>
          </h1>
          <p className="text-sm text-[var(--ink-muted)]">Ventas pagadas, comisión y lo que falta pagarle a cada uno, en vivo.</p>
        </div>
        {staff.platform && !staff.readOnly && (
          <a href="#nuevo" className="btn btn-primary">
            + Nuevo promotor
          </a>
        )}
      </div>

      {promoters.length === 0 ? (
        <p className="card p-5 text-sm text-[var(--ink-muted)]">Todavía no hay promotores. {staff.platform ? "Dalo de alta abajo, en un solo paso." : "Los crea iPass."}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="eyebrow border-b border-[var(--border)]">
              <tr>
                <th className="px-5 py-3 font-normal">Promotor</th>
                <th className="px-5 py-3 font-normal">Eventos y comisión</th>
                <th className="px-5 py-3 text-right font-normal">Ventas</th>
                <th className="px-5 py-3 text-right font-normal">Cobrado</th>
                <th className="px-5 py-3 text-right font-normal">Comisión</th>
                <th className="px-5 py-3 text-right font-normal">Por pagar</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {promoters.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                  <td className="px-5 py-3">
                    <p className="font-medium">{p.name}</p>
                    <p className="font-mono text-xs text-[var(--ink-dim)]">{p.code ?? p.email}</p>
                    {p.phone && <p className="text-xs text-[var(--ink-dim)]">{p.phone}</p>}
                    {!p.active && <p className="text-xs text-[var(--ink-dim)]">Desactivado</p>}
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {p.promoterEvents.length === 0 ? (
                      <span className="text-[var(--warn)]">Sin eventos asignados</span>
                    ) : (
                      p.promoterEvents.map((a) => (
                        <span key={a.eventId} className="block">
                          {a.event.title} ·{" "}
                          <span className="text-[var(--ink-dim)]">
                            {commissionLabel(a, money)}
                            {a.quota ? ` · cupo ${a.quota}` : ""}
                          </span>
                        </span>
                      ))
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-mono">{p.orders}</td>
                  <td className="px-5 py-3 text-right font-mono">{money(p.amount)}</td>
                  <td className="px-5 py-3 text-right font-mono font-semibold text-[var(--success)]">{money(p.commission)}</td>
                  <td className={`px-5 py-3 text-right font-mono ${p.toSettle > 0 ? "font-semibold text-[var(--warn)]" : "text-[var(--ink-dim)]"}`}>{money(p.toSettle)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/promotores/${p.id}`} className="btn text-xs">
                      Ver, asignar y liquidar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-[var(--border)] font-semibold">
              <tr>
                <td className="px-5 py-3" colSpan={3}>
                  Total
                </td>
                <td className="px-5 py-3 text-right font-mono">{money(total.amount)}</td>
                <td className="px-5 py-3 text-right font-mono text-[var(--success)]">{money(total.commission)}</td>
                <td className="px-5 py-3 text-right font-mono text-[var(--warn)]">{money(total.toSettle)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {staff.platform && !staff.readOnly && (
        <section id="nuevo" className="card scroll-mt-6 p-6">
          <h2 className="eyebrow mb-1">Nuevo promotor</h2>
          <p className="mb-4 text-sm text-[var(--ink-muted)]">
            En un solo paso: su cuenta (con una contraseña temporal que cambia al entrar) y el evento que va a vender con su comisión. Su enlace para la
            web se arma solo con su nombre. Después puedes sumarle más eventos en su ficha.
          </p>
          {events.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Primero crea un evento con venta y funciones por delante.</p>
          ) : (
            <ActionForm action={createPromoterAction} className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="label">
                  Nombre
                  <input name="name" required minLength={3} className="field" />
                </label>
                <label className="label">
                  Email (para entrar)
                  <input name="email" type="email" required className="field" />
                </label>
                <label className="label">
                  Teléfono o WhatsApp
                  <input name="phone" type="tel" placeholder="77123456" className="field w-36" />
                </label>
                <label className="label">
                  Contraseña temporal
                  <input name="password" type="text" required minLength={MIN_PASSWORD_LENGTH} autoComplete="off" className="field" />
                </label>
              </div>
              <PromoterAssignmentFields events={events} />
              <button type="submit" className="btn btn-primary">
                Crear el promotor
              </button>
            </ActionForm>
          )}
        </section>
      )}
    </div>
  );
}
