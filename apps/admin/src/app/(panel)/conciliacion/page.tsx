import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, formatCode, formatDateTime, formatMoney, utcToZonedInput, zonedDateTimeToUtc } from "@ticketera/core";
import { paymentDetails, paymentReconciliation, prisma, reconciliationProviders } from "@ticketera/db";
import { FilterForm } from "@/components/filter-form";
import { Help } from "@/components/help";
import { PAGE_SIZE, Pager, pageFrom } from "@/components/pager";
import { methodName } from "@/lib/sales";
import { ROLES, isGlobalView, requireStaff } from "@/lib/session";
import { CompareForm } from "./compare-form";

export const metadata: Metadata = { title: "Conciliación" };

type Props = { searchParams: Promise<{ desde?: string; hasta?: string; q?: string; medio?: string; estado?: string; org?: string; dia?: string; pagina?: string }> };

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
  const detailFilters = { organizationId: orgId, ...range, provider: medio || undefined, status: estado || undefined, day: dia || undefined, q: q || undefined };
  const firstPage = await paymentDetails(detailFilters, 0, 0);
  const page = pageFrom(params.pagina, Math.ceil(firstPage.total / PAGE_SIZE));
  const detail = await paymentDetails(detailFilters, (page - 1) * PAGE_SIZE, PAGE_SIZE);
  const detailParams = { desde: params.desde, hasta: params.hasta, q, medio, estado, org: params.org, dia };
  const filtered = Boolean(q || medio || estado || dia || (global && params.org));
  const dayHref = (day: string, provider: string) => {
    const next = new URLSearchParams(Object.entries({ ...detailParams, dia: day, medio: provider }).filter(([, v]) => v) as [string, string][]);
    return `/conciliacion?${next.toString()}#detalle`;
  };
  /** Quién cobró: el cajero, el promotor o el cliente mismo en la web. */
  const seller = (o: { channel: string; issuedBy: { name: string } | null; promoter: { name: string } | null }) =>
    o.issuedBy?.name ?? (o.promoter ? `${o.promoter.name} (promotor)` : o.channel === "ONLINE" ? "El cliente, en la web" : o.channel);
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
                <tr key={`${r.day}-${r.provider}`} className={dia === r.day && medio === r.provider ? "bg-[var(--accent-soft)]" : ""}>
                  <td className="px-5 py-2 font-mono">{r.day}</td>
                  <td className="px-5 py-2">{methodName(r.provider)}</td>
                  <td className="px-5 py-2 text-right">{r.count}</td>
                  <td className="px-5 py-2 text-right font-mono">{formatMoney(r.amount, r.currency)}</td>
                  <td className="px-5 py-2 text-right">
                    <Link href={dayHref(r.day, r.provider)} className="text-xs font-medium text-[var(--accent)] hover:underline">
                      Ver los {r.count} cobro(s) →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.byDay.some((r) => r.provider === "directo") && (
          <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--ink-dim)]">
            «Pase directo» son las compras de la web mientras no haya una pasarela de pago conectada: el sistema las da por cobradas sin que pase dinero por un banco.
            Toca «Ver los cobros» para ver quién compró, qué y por cuánto.
          </p>
        )}
      </section>

      <section id="detalle" className="card overflow-x-auto scroll-mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
          <h2 className="eyebrow">
            Detalle de los cobros · {detail.total} cobro(s) · {money(detail.amount)}
            {dia && <span className="ml-2 normal-case text-[var(--ink-muted)]">del {dia}</span>}
          </h2>
          {(dia || medio) && filtered && (
            <Link href={`/conciliacion?${new URLSearchParams(Object.entries({ ...detailParams, dia: "", medio: "" }).filter(([, v]) => v) as [string, string][]).toString()}`} className="text-xs text-[var(--accent)] hover:underline">
              Quitar el filtro de día y medio
            </Link>
          )}
        </div>
        {detail.rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">{filtered ? "Ningún cobro coincide con la búsqueda." : "Sin cobros en el período."}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="eyebrow border-b border-[var(--border)]">
              <tr>
                <th className="px-5 py-2 font-normal">Cobrado</th>
                <th className="px-3 py-2 font-normal">Orden</th>
                <th className="px-3 py-2 font-normal">Comprador</th>
                <th className="px-3 py-2 font-normal">Qué compró</th>
                <th className="px-3 py-2 font-normal">Medio · referencia</th>
                <th className="px-3 py-2 font-normal">Lo cobró</th>
                <th className="px-3 py-2 text-right font-normal">Monto</th>
                <th className="px-5 py-2 font-normal">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {detail.rows.map((p) => (
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
                        {i.quantity} × {i.ticketType.name} <span className="text-[var(--ink-dim)]">({money(i.unitAmount)} c/u)</span>
                        <span className="block text-[var(--ink-dim)]">
                          {i.ticketType.session.event.title}
                          {global ? ` · ${i.ticketType.session.event.organization.name}` : ""}
                        </span>
                      </span>
                    ))}
                    {p.order.promoRedemption && <span className="block text-[var(--success)]">código {p.order.promoRedemption.promoCode.code}{p.order.discountAmount > 0 ? ` · −${money(p.order.discountAmount)}` : ""}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {methodName(p.provider)}
                    <span className="block font-mono text-xs text-[var(--ink-dim)]">{p.providerPaymentId ?? "sin referencia"}</span>
                  </td>
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
        )}
        <div className="px-5 py-3">
          <Pager path="/conciliacion" params={detailParams} page={page} total={detail.total} />
        </div>
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
