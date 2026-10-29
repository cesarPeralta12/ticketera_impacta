import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, commissionLabel, formatCode, formatDateTime, formatMoney } from "@ticketera/core";
import { findPromoter, listPromoCodes, prisma, promoterEvents, promoterSales, requireEnv } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { PromoterAssignmentFields } from "@/components/promoter-assignment-fields";
import { assignPromoterAction, settlePromoterAction, unassignPromoterAction, updatePromoterPhoneAction } from "@/lib/actions/promoters";
import { pickerEvents } from "@/lib/picker-events";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Promotor" };

/**
 * Un promotor: sus eventos (funciones, comisión, cupo y vigencia: asignar, cambiar, quitar), lo que vendió, su
 * comisión por pagar con la liquidación, y su enlace.
 */
export default async function PromoterPage({ params }: { params: Promise<{ userId: string }> }) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { userId } = await params;
  const promoter = await findPromoter(prisma, staff.organization.id, userId);
  if (!promoter) notFound();

  const now = new Date();
  const [assignments, sales, code, events, allCodes] = await Promise.all([
    // (todos los códigos de la organización; abajo se muestran los de este promotor)
    promoterEvents(promoter.id, staff.organization.id, now),
    promoterSales(promoter.id, { organizationId: staff.organization.id, take: 30 }, now),
    prisma.promoCode.findFirst({ where: { organizationId: staff.organization.id, promoterId: promoter.id, eventId: null, discountValue: 0 }, select: { code: true } }),
    pickerEvents(staff.organization.id, now),
    listPromoCodes(staff.organization.id, now),
  ]);
  const codes = allCodes.filter((c) => c.promoterId === promoter.id);
  const money = (c: number) => formatMoney(c, staff.organization.currency);
  const assigned = new Set(assignments.map((a) => a.eventId));
  const available = events.filter((e) => !assigned.has(e.id));
  const web = requireEnv("WEB_URL").replace(/\/$/, "");
  const editable = !staff.readOnly;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/promotores" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Promotores
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{promoter.name}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {promoter.email}
          {promoter.phone && ` · ${promoter.phone}`}
          {code && (
            <>
              {" "}
              · código <strong className="font-mono">{code.code}</strong>
            </>
          )}
        </p>
      </div>

      <dl className="stats grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "Comisión ganada", value: money(sales.totals.commission), tone: "magenta" },
          { label: "Por pagarle", value: money(sales.totals.toSettle), tone: "amber" },
          { label: "Entradas vendidas", value: String(sales.totals.tickets), tone: "blue" },
          { label: "Cobrado", value: money(sales.totals.amount), tone: "blue" },
          { label: "Hoy", value: `${sales.today.tickets} entr. · ${money(sales.today.amount)}`, tone: "blue" },
        ].map((s) => (
          <div key={s.label} className={`card tone-${s.tone} p-4`}>
            <dt className="eyebrow">{s.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      <section className="card p-6">
        <h2 className="eyebrow mb-1">Eventos que vende</h2>
        <p className="mb-4 text-sm text-[var(--ink-muted)]">
          Solo estos le aparecen para vender, y solo las funciones marcadas. La comisión: un % de lo que paga el cliente o un monto por entrada. El cupo
          es cuántas entradas puede vender él en ese evento (vacío: hasta agotar).
        </p>
        {assignments.length === 0 ? (
          <p className="mb-4 rounded-md bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">Sin eventos: al entrar no tiene nada para vender.</p>
        ) : (
          <ul className="mb-5 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {assignments.map(({ event, scope, ...rule }) => {
              const sold = sales.byEvent.find((e) => e.eventId === event.id);
              const link = code ? `${web}/eventos/${event.slug}?promo=${code.code}` : null;
              const functions = scope.whole ? "todas las funciones" : `${scope.sessionIds.length} función(es)`;
              const window = [scope.startsAt && `desde ${formatDateTime(scope.startsAt, DEFAULT_TIMEZONE)}`, scope.endsAt && `hasta ${formatDateTime(scope.endsAt, DEFAULT_TIMEZONE)}`]
                .filter(Boolean)
                .join(" ");
              const pickable = events.find((e) => e.id === event.id);
              return (
                <li key={event.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <span className="block font-medium">{event.title}</span>
                      <span className="text-sm text-[var(--ink-muted)]">
                        {commissionLabel(rule, money)} · {functions}
                        {rule.quota ? ` · cupo ${rule.quota}` : ""}
                        {window ? ` · ${window}` : ""}
                      </span>
                      <span className="block text-xs text-[var(--ink-dim)]">
                        {sold ? `${sold.tickets} entrada(s), ${money(sold.amount)} cobrado, ${money(sold.commission)} de comisión` : "Sin ventas todavía"}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {link && <CopyButton text={link} label="Copiar su enlace" />}
                      {editable && (
                        <ActionForm action={unassignPromoterAction} confirm={`¿Quitar "${event.title}" a ${promoter.name}? Lo que ya vendió sigue sumando.`}>
                          <input type="hidden" name="userId" value={promoter.id} />
                          <input type="hidden" name="eventId" value={event.id} />
                          <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                            Quitar
                          </button>
                        </ActionForm>
                      )}
                    </span>
                  </div>
                  {editable && pickable && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-[var(--accent)]">Cambiar funciones, comisión, cupo o vigencia</summary>
                      <ActionForm action={assignPromoterAction} className="mt-3 space-y-3">
                        <input type="hidden" name="userId" value={promoter.id} />
                        <PromoterAssignmentFields
                          events={[pickable]}
                          current={{
                            eventId: event.id,
                            sessionIds: scope.whole ? [] : scope.sessionIds,
                            commissionType: rule.commissionType,
                            commissionValue: rule.commissionValue,
                            quota: rule.quota,
                            startsAt: scope.startsAt,
                            endsAt: scope.endsAt,
                          }}
                        />
                        <button type="submit" className="btn btn-primary">
                          Guardar cambios
                        </button>
                      </ActionForm>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {editable &&
          (available.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">{events.length === 0 ? "No hay eventos con venta y funciones por delante para asignar." : "Ya tiene todos los eventos con venta."}</p>
          ) : (
            <ActionForm action={assignPromoterAction} resetOnSuccess className="space-y-3 rounded-lg border border-dashed border-[var(--border)] p-4">
              <input type="hidden" name="userId" value={promoter.id} />
              <p className="text-sm font-semibold">Asignar otro evento</p>
              <PromoterAssignmentFields events={available} />
              <button type="submit" className="btn btn-primary">
                Asignar
              </button>
            </ActionForm>
          ))}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="card space-y-3 p-6">
          <h2 className="eyebrow">Liquidación de comisiones</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            Por pagarle: <strong className="text-[var(--ink)]">{money(sales.totals.toSettle)}</strong> ({sales.totals.toSettleOrders} venta(s) pagada(s) sin liquidar).
            Al liquidar se marcan como pagadas y lo que venda después queda para la próxima.
          </p>
          {editable && sales.totals.toSettle > 0 && (
            <ActionForm action={settlePromoterAction} confirm={`¿Registrar que se le pagaron ${money(sales.totals.toSettle)} a ${promoter.name}?`} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="userId" value={promoter.id} />
              <label className="label min-w-48 flex-1">
                Nota (opcional)
                <input name="note" maxLength={200} placeholder="ej. transferencia BNB 28/10" className="field" />
              </label>
              <button type="submit" className="btn btn-primary">
                Liquidar {money(sales.totals.toSettle)}
              </button>
            </ActionForm>
          )}
          {sales.payouts.length > 0 && (
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] text-sm">
              {sales.payouts.map((p) => (
                <li key={p.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span>
                    <span className="font-mono font-semibold">{formatMoney(p.amount, p.currency)}</span> · {p.orders} venta(s)
                    {p.note && <span className="block text-xs text-[var(--ink-dim)]">{p.note}</span>}
                  </span>
                  <span className="text-xs text-[var(--ink-dim)]">
                    {formatDateTime(p.createdAt, DEFAULT_TIMEZONE)} · {p.createdBy.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card space-y-3 p-6">
          <h2 className="eyebrow">Contacto</h2>
          {editable ? (
            <ActionForm action={updatePromoterPhoneAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="userId" value={promoter.id} />
              <label className="label">
                Teléfono o WhatsApp
                <input name="phone" type="tel" defaultValue={promoter.phone ?? ""} placeholder="77123456" className="field" />
              </label>
              <button type="submit" className="btn">
                Guardar
              </button>
            </ActionForm>
          ) : (
            <p className="text-sm">{promoter.phone ?? "Sin teléfono."}</p>
          )}
          <p className="text-xs text-[var(--ink-dim)]">
            Para desactivar la cuenta o cerrar sus sesiones: <Link href="/usuarios" className="underline">Usuarios</Link>. Sus ventas y su historial se conservan.
          </p>
        </section>
      </div>

      <section className="card space-y-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="eyebrow">Códigos de este promotor</h2>
          {editable && (
            <Link href={`/promociones?promotor=${promoter.id}#nuevo`} className="btn px-3 py-1.5 text-sm">
              + Crear código con descuento para {promoter.name}
            </Link>
          )}
        </div>
        {codes.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">Todavía no tiene códigos.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {codes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/promociones/${c.id}`} className="font-mono font-semibold text-[var(--accent)] hover:underline">
                  {c.code}
                </Link>
                <span className="text-[var(--ink-muted)]">
                  {c.event?.title ?? "Todos los eventos"} · {c.paidUses} uso(s) pagado(s) · comisión {money(c.commission)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-x-auto">
        <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">Últimas ventas</h2>
        {sales.recent.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">Todavía no vendió.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-[var(--border)]">
              {sales.recent.map((o) => {
                const paid = o.status === "PAID" || o.status === "PARTIALLY_REFUNDED";
                const waiting = o.status === "PENDING_PAYMENT" && o.expiresAt > now;
                return (
                  <tr key={o.id}>
                    <td className="px-5 py-2.5">
                      <Link href={`/ordenes/${o.code}`} className="block font-medium hover:underline">
                        {o.buyerName}
                      </Link>
                      <span className="text-xs text-[var(--ink-dim)]">
                        {o.channel === "PROMOTER" ? "Vendida por él" : "Web con su código"} · {formatCode(o.code)} · {formatDateTime(o.createdAt, DEFAULT_TIMEZONE)}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">{o.event?.title}</td>
                    <td className="px-5 py-2.5 text-right font-mono">{formatMoney(o.totalAmount, o.currency)}</td>
                    <td className={`px-5 py-2.5 text-right font-mono ${paid ? "text-[var(--success)]" : "text-[var(--ink-dim)]"}`}>
                      {formatMoney(o.commissionAmount, o.currency)}
                      {paid && <span className="block text-xs font-sans text-[var(--ink-dim)]">{o.commissionPayoutId ? "liquidada" : "por pagar"}</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <span
                        className={`badge ${paid ? "bg-[var(--success-soft)] text-[var(--success)]" : waiting ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--surface-2)] text-[var(--ink-dim)]"}`}
                      >
                        {paid ? "Pagada" : waiting ? "Esperando pago" : o.status === "CANCELLED" ? "Anulada" : o.status === "REFUNDED" ? "Devuelta" : "Venció"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
