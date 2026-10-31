import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, formatCode, formatDateTime, formatMoney, utcToZonedInput, zonedDateTimeToUtc } from "@ticketera/core";
import { paymentDetails, paymentReconciliation, prisma, reconciliationProviders } from "@ticketera/db";
import { FilterForm } from "@/components/filter-form";
import { Help } from "@/components/help";
import { PAGE_SIZE, Pager, pageFrom } from "@/components/pager";
import { PaymentTable } from "./payment-table";
import { methodName } from "@/lib/sales";
import { ROLES, isGlobalView, requireStaff } from "@/lib/session";
import { CompareForm } from "./compare-form";

export const metadata: Metadata = { title: "Conciliación" };

type Props = { searchParams: Promise<{ desde?: string; hasta?: string; q?: string; medio?: string; estado?: string; org?: string; dia?: string; pagina?: string; vista?: string }> };

const VIEWS = ["resumen", "cobros", "revisar", "comparar"] as const;
type View = (typeof VIEWS)[number];
/** Cuántos cobros se muestran al abrir un día y medio; el resto está en la pestaña de detalle. */
const PREVIEW_ROWS = 25;

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
  const global = isGlobalView(staff);
  const q = (params.q ?? "").trim();
  const medio = params.medio ?? "";
  const estado = params.estado === "aprobado" || params.estado === "devuelto" ? params.estado : "";
  const dia = isDay(params.dia) && params.dia >= from && params.dia <= to ? params.dia : "";
  const organizations = global ? await prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const orgId = global ? (organizations.some((o) => o.id === params.org) ? params.org! : null) : staff.organization.id;
  const range = { from: zonedDateTimeToUtc(`${from}T00:00`, DEFAULT_TIMEZONE), to: zonedDateTimeToUtc(`${shift(to, 1)}T00:00`, DEFAULT_TIMEZONE) };
  const data = await paymentReconciliation({ organizationId: orgId, ...range });
  const providers = await reconciliationProviders({ organizationId: orgId, ...range });
  const vista: View = VIEWS.find((v) => v === params.vista) ?? "resumen";
  const detailParams = { desde: params.desde, hasta: params.hasta, q, medio, estado, org: params.org, dia, vista };
  const filtered = Boolean(q || medio || estado || dia || (global && params.org));
  const link = (extra: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...detailParams, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/conciliacion?${next.toString()}`;
  };
  // Solo se consulta lo de la pestaña abierta.
  const detailFilters = { organizationId: orgId, ...range, provider: medio || undefined, status: estado || undefined, day: dia || undefined, q: q || undefined };
  const detailTotal = vista === "cobros" ? (await paymentDetails(detailFilters, 0, 0)).total : 0;
  const page = pageFrom(params.pagina, Math.ceil(detailTotal / PAGE_SIZE));
  const detail = vista === "cobros" ? await paymentDetails(detailFilters, (page - 1) * PAGE_SIZE, PAGE_SIZE) : null;
  // Cada día y medio trae sus cobros para abrirlos ahí mismo (respeta la búsqueda y el estado).
  const byDay = vista === "resumen" ? data.byDay.filter((r) => (!medio || r.provider === medio) && (!dia || r.day === dia)) : [];
  const dayPayments = await Promise.all(byDay.slice(0, 40).map((r) => paymentDetails({ ...detailFilters, provider: r.provider, day: r.day }, 0, PREVIEW_ROWS)));
  const currency = staff.organization.currency;
  const money = (c: number) => formatMoney(c, currency);
  const issues = data.issues;
  const problems = issues.approvedWithoutTickets.length + issues.doubles.length + issues.paidWithoutPayment.length;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{global ? (orgId ? (organizations.find((o) => o.id === orgId)?.name ?? "") : "Todos los organizadores") : staff.organization.name}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          Conciliación de cobros
          <Help title="Conciliación">
            Cada día, compara lo que el sistema dio por cobrado con lo que llegó al banco o a la pasarela. El efectivo y el QR de caja los declara el cajero;
            el QR de pasarela lo confirma el banco. Pega el reporte de la pasarela abajo para ver las diferencias.
          </Help>
        </h1>
      </div>

      <FilterForm key={JSON.stringify(params)}>
        <input type="hidden" name="vista" value={vista} />
        <label className="label grow basis-56">
          Buscar un cobro
          <input type="search" name="q" defaultValue={q} placeholder="Orden, comprador, CI, referencia, quién cobró o evento" className="field" autoComplete="off" />
        </label>
        <label className="label">
          Desde
          <input type="date" name="desde" defaultValue={from} className="field" />
        </label>
        <label className="label">
          Hasta
          <input type="date" name="hasta" defaultValue={to} className="field" />
        </label>
        <label className="label">
          Medio
          <select name="medio" defaultValue={medio} className="field">
            <option value="">Todos</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {methodName(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Estado
          <select name="estado" defaultValue={estado} className="field">
            <option value="">Cobrados y devueltos</option>
            <option value="aprobado">Cobrados</option>
            <option value="devuelto">Devueltos</option>
          </select>
        </label>
        {global && (
          <label className="label">
            Organizador
            <select name="org" defaultValue={params.org ?? ""} className="field max-w-52">
              <option value="">Todos</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </FilterForm>

      <nav aria-label="Secciones" className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {[
          { id: "resumen", label: "Cobrado por día y medio", note: `${data.totals.count}` },
          { id: "cobros", label: "Detalle de los cobros", note: "" },
          { id: "revisar", label: "Para revisar", note: problems > 0 ? `${problems}` : "" },
          { id: "comparar", label: "Comparar con la pasarela", note: "" },
        ].map((tab) => (
          <Link
            key={tab.id}
            href={link({ vista: tab.id, pagina: undefined })}
            aria-current={vista === tab.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${vista === tab.id ? "border-[var(--accent)] font-semibold text-[var(--ink)]" : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"}`}
          >
            {tab.label}
            {tab.note && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${tab.id === "revisar" ? "bg-[var(--warn-soft)] text-[var(--danger)]" : "bg-[var(--border)] text-[var(--ink-muted)]"}`}>{tab.note}</span>}
          </Link>
        ))}
      </nav>

      {vista === "resumen" && (
        <section className="card overflow-x-auto">
          <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">
            Cobrado por día y medio · total {money(data.totals.amount)} ({data.totals.count} pago(s))
          </h2>
          {byDay.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">Sin cobros en el período.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {byDay.map((r, idx) => {
                const rows = dayPayments[idx];
                return (
                  <details key={`${r.day}-${r.provider}`} className="group" open={dia === r.day && medio === r.provider}>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-1 px-5 py-2.5 text-sm hover:bg-[var(--accent-soft)]">
                      <span className="w-28 font-mono">{r.day}</span>
                      <span className="min-w-36 grow">{methodName(r.provider)}</span>
                      <span className="w-24 text-right">{r.count} cobro(s)</span>
                      <span className="w-32 text-right font-mono">{formatMoney(r.amount, r.currency)}</span>
                      <span className="text-xs font-medium text-[var(--accent)] group-open:hidden">Ver cobros ▾</span>
                      <span className="hidden text-xs font-medium text-[var(--accent)] group-open:inline">Ocultar ▴</span>
                    </summary>
                    <div className="overflow-x-auto border-t border-[var(--border)]">
                      {!rows ? (
                        <Link href={link({ vista: "cobros", dia: r.day, medio: r.provider, pagina: undefined })} className="block px-5 py-3 text-sm text-[var(--accent)] hover:underline">
                          Ver los cobros en el detalle →
                        </Link>
                      ) : rows.rows.length === 0 ? (
                        <p className="px-5 py-3 text-sm text-[var(--ink-muted)]">Ningún cobro coincide con la búsqueda.</p>
                      ) : (
                        <>
                          <PaymentTable rows={rows.rows} global={global} showMedium={false} />
                          {rows.total > rows.rows.length && (
                            <Link href={link({ vista: "cobros", dia: r.day, medio: r.provider, pagina: undefined })} className="block px-5 py-3 text-sm text-[var(--accent)] hover:underline">
                              Se muestran {rows.rows.length} de {rows.total} · ver todos en el detalle →
                            </Link>
                          )}
                        </>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
          {data.byDay.some((r) => r.provider === "directo") && (
            <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--ink-dim)]">
              «Pase directo» son las compras de la web mientras no haya una pasarela de pago conectada: el sistema las da por cobradas sin que pase dinero por un banco.
              Abre la fila para ver quién compró, qué y por cuánto.
            </p>
          )}
        </section>
      )}

      {vista === "cobros" && detail && (
        <section className="card overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
            <h2 className="eyebrow">
              Detalle de los cobros · {detail.total} cobro(s) · {money(detail.amount)}
              {dia && <span className="ml-2 normal-case text-[var(--ink-muted)]">del {dia}</span>}
            </h2>
            {(dia || medio) && (
              <Link href={link({ dia: "", medio: "", pagina: undefined })} className="text-xs text-[var(--accent)] hover:underline">
                Quitar el filtro de día y medio
              </Link>
            )}
          </div>
          {detail.rows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">{filtered ? "Ningún cobro coincide con la búsqueda." : "Sin cobros en el período."}</p>
          ) : (
            <PaymentTable rows={detail.rows} global={global} />
          )}
          <div className="px-5 py-3">
            <Pager path="/conciliacion" params={detailParams} page={page} total={detail.total} />
          </div>
        </section>
      )}

      {vista === "revisar" && (
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
      )}

      {vista === "comparar" && (
        <section className="card p-5">
          <h2 className="eyebrow mb-3">Comparar con el reporte de la pasarela</h2>
          <CompareForm from={from} to={to} currency={currency} />
        </section>
      )}
    </div>
  );
}
