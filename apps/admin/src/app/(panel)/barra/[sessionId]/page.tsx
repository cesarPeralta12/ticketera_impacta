import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatCode, formatDateTime, formatMoney, formatTime, tableLabel } from "@ticketera/core";
import { nightConsumption, prisma, searchNightVouchers } from "@ticketera/db";
import { FilterForm } from "@/components/filter-form";
import { PAGE_SIZE, Pager, pageFrom } from "@/components/pager";
import { staffCanSell } from "@/lib/sales-access";
import { ROLES, requireStaff } from "@/lib/session";
import { BarTerminal } from "./bar-terminal";

export const metadata: Metadata = { title: "Barra" };

type Props = { params: Promise<{ sessionId: string }>; searchParams: Promise<{ q?: string; estado?: string; tipo?: string; pagina?: string }> };

export default async function BarNightPage({ params, searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.bar);
  const { sessionId } = await params;
  const night = await prisma.eventSession.findFirst({
    where: { id: sessionId, event: { organizationId: staff.organization.id } },
    include: { event: { select: { title: true } }, venue: { select: { name: true, timezone: true } } },
  });
  if (!night) notFound();
  if (!(await staffCanSell(staff, night))) {
    return (
      <div className="space-y-4">
        <Link href="/barra" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Barra
        </Link>
        <p className="card p-5 text-sm text-[var(--ink-muted)]">No tienes asignada esta función: pídele a iPass que te la asigne.</p>
      </div>
    );
  }
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const estado = sp.estado === "leidos" || sp.estado === "sin-leer" ? sp.estado : "";
  const creditTypes = await prisma.ticketType.findMany({ where: { sessionId: night.id, credits: { some: { amount: { gt: 0 } } } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const tipo = creditTypes.some((t) => t.id === sp.tipo) ? sp.tipo! : "";
  const filters = { sessionId: night.id, q: q || undefined, estado: estado || undefined, ticketTypeId: tipo || undefined };
  const first = await searchNightVouchers(filters, 0, 0);
  const page = pageFrom(sp.pagina, Math.ceil(first.total / PAGE_SIZE));
  const vouchers = await searchNightVouchers(filters, (page - 1) * PAGE_SIZE, PAGE_SIZE);
  const summary = await nightConsumption(night.id);
  const currency = staff.organization.currency;
  const tz = night.venue.timezone;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/barra" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Barra
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{night.event.title}</h1>
        <p className="text-sm capitalize text-[var(--ink-muted)]">
          {formatDateTime(night.startsAt, tz)} · {night.venue.name}
        </p>
      </div>

      <BarTerminal sessionId={night.id} timeZone={tz} readOnly={staff.readOnly} />

      <section className="card p-6">
        <h2 className="eyebrow mb-3">QR de consumo de la noche</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-sm text-[var(--ink-muted)]">Consumo vendido (mesas y entradas con trago)</p>
            <p className="font-mono text-xl">{formatMoney(summary.amount, currency)}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--ink-muted)]">Ya leído en barra</p>
            <p className="font-mono text-xl text-[var(--accent)]">{formatMoney(summary.spent, currency)}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--ink-muted)]">Todavía sin leer</p>
            <p className="font-mono text-xl">{formatMoney(summary.amount - summary.spent, currency)}</p>
          </div>
        </div>
        {summary.byType.length > 0 && (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="eyebrow border-b border-[var(--border)]">
              <tr>
                <th className="py-2 pr-4 font-normal">Tipo</th>
                <th className="py-2 pr-4 text-right font-normal">Vendidas</th>
                <th className="py-2 pr-4 text-right font-normal">Incluido</th>
                <th className="py-2 text-right font-normal">Leído</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {summary.byType.map((t) => (
                <tr key={t.name}>
                  <td className="py-2 pr-4">{t.name}</td>
                  <td className="py-2 pr-4 text-right font-mono">
                    {t.count} {t.kind === "TABLE" ? "mesa(s)" : "entrada(s)"}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono">{formatMoney(t.amount, currency)}</td>
                  <td className="py-2 text-right font-mono">{formatMoney(t.spent, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-x-auto">
        <div className="border-b border-[var(--border)] px-5 py-3">
          <h2 className="eyebrow">
            QR de consumo de la noche · {vouchers.total} vale(s) · {formatMoney(vouchers.amount, currency)}
          </h2>
        </div>
        <div className="px-5 pt-4">
          <FilterForm key={JSON.stringify(sp)}>
            <label className="label grow basis-56">
              Buscar
              <input type="search" name="q" defaultValue={q} placeholder="Comprador, orden, código, mesa, quién lo leyó o su detalle" className="field" autoComplete="off" />
            </label>
            <label className="label">
              Estado
              <select name="estado" defaultValue={estado} className="field">
                <option value="">Todos</option>
                <option value="sin-leer">Sin leer</option>
                <option value="leidos">Leídos</option>
              </select>
            </label>
            {creditTypes.length > 1 && (
              <label className="label">
                Tipo
                <select name="tipo" defaultValue={tipo} className="field">
                  <option value="">Todos</option>
                  {creditTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </FilterForm>
        </div>
        {vouchers.rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">{q || estado || tipo ? "Ningún vale coincide con la búsqueda." : "Todavía no hay mesas ni entradas con consumo vendidas para esta noche."}</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="eyebrow border-y border-[var(--border)]">
              <tr>
                <th className="px-5 py-2 font-normal">Mesa o entrada</th>
                <th className="px-3 py-2 font-normal">Comprador</th>
                <th className="px-3 py-2 text-right font-normal">Consumo</th>
                <th className="px-3 py-2 font-normal">Estado</th>
                <th className="px-3 py-2 font-normal">Leído por</th>
                <th className="px-3 py-2 font-normal">Detalle</th>
                <th className="px-5 py-2 font-normal">Código</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {vouchers.rows.map((v) => (
                <tr key={v.code} className="align-top">
                  <td className="px-5 py-2.5 font-medium">
                    {v.label}
                    {v.people > 1 && <span className="block text-xs font-normal text-[var(--ink-dim)]">{v.people} personas</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {v.buyer}
                    <span className="block font-mono text-xs text-[var(--ink-dim)]">{formatCode(v.orderCode)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatMoney(v.amount, v.currency)}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`badge ${v.cancelled ? "bg-[var(--danger-soft)] text-[var(--danger)]" : v.redeemedAt ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--surface-2)] text-[var(--ink-muted)]"}`}
                    >
                      {v.cancelled ? "Anulado" : v.redeemedAt ? "Leído" : "Sin leer"}
                    </span>
                    {v.redeemedAt && <span className="block text-xs text-[var(--ink-dim)]">{formatDateTime(v.redeemedAt, tz)}</span>}
                  </td>
                  <td className="px-3 py-2.5">{v.redeemedBy ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-[var(--ink-muted)]">{v.note ?? "—"}</td>
                  <td className="px-5 py-2.5 font-mono text-xs">{formatCode(v.code)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-5 py-3">
          <Pager path={`/barra/${night.id}`} params={{ q, estado, tipo }} page={page} total={vouchers.total} />
        </div>
      </section>

      <section className="card p-6">
        <h2 className="eyebrow mb-3">Últimos QR leídos</h2>
        {summary.recent.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">Todavía no se leyó ningún QR de consumo esta noche.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {summary.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {formatTime(r.createdAt, tz)} ·{" "}
                  {tableLabel(r.credit.ticketType.name, r.credit.tableNumber, r.credit.seat?.label) ?? r.credit.ticketType.name} · {r.staff.name}
                  {r.note && <span className="text-[var(--ink-dim)]"> · {r.note}</span>}
                </span>
                <span className="font-mono">{formatMoney(r.amount, currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
