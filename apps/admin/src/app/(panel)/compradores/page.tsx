import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, formatDateTime, formatMoney } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { CHANNEL_LABEL } from "@/lib/labels";
import { buyersDirectory } from "@/lib/sales";
import { ROLES, isGlobalView, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Compradores" };

type Props = { searchParams: Promise<{ q?: string; org?: string; orden?: string }> };

const SORTS = {
  reciente: { label: "Compra más reciente", by: (a: { lastPurchase: Date }, b: { lastPurchase: Date }) => +b.lastPurchase - +a.lastPurchase },
  gasto: { label: "Más gastado", by: (a: { total: number }, b: { total: number }) => b.total - a.total },
  compras: { label: "Más compras", by: (a: { orders: number }, b: { orders: number }) => b.orders - a.orders },
} as const;

/**
 * Directorio de compradores: cada persona una vez, con todo lo que compró online o en
 * boletería. IMPACTA (vista general) ve los de todos los organizadores; un organizador,
 * los de sus eventos.
 */
export default async function BuyersPage({ searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const global = isGlobalView(staff);
  const { q = "", org = "", orden = "reciente" } = await searchParams;
  const sort = SORTS[orden as keyof typeof SORTS] ?? SORTS.reciente;

  const [{ buyers, anonymousPos }, organizers] = await Promise.all([
    buyersDirectory(staff, { q, org }),
    global ? prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const sorted = buyers.toSorted(sort.by as (a: (typeof buyers)[number], b: (typeof buyers)[number]) => number);
  const shown = sorted.slice(0, 300);
  const exportHref = `/compradores/csv?${new URLSearchParams(Object.entries({ q, org }).filter(([, v]) => v)).toString()}`;
  const totalSpent = buyers.reduce((sum, b) => sum + b.total, 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{global ? "Todos los organizadores" : staff.organization.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Compradores</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Cada persona una sola vez, con todo lo que compró online o en boletería.{" "}
          <span className="font-medium text-[var(--ink)]">
            {buyers.length} comprador(es) · {formatMoney(totalSpent, staff.organization.currency)}
          </span>
          {anonymousPos > 0 && ` · ${anonymousPos} venta(s) de boletería sin datos del comprador no se cuentan.`}
        </p>
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4">
        <label className="label min-w-56 flex-1">
          Buscar
          <input name="q" defaultValue={q} placeholder="Nombre, email o CI" className="field" />
        </label>
        <label className="label">
          Ordenar por
          <select name="orden" defaultValue={orden} className="field">
            {Object.entries(SORTS).map(([value, s]) => (
              <option key={value} value={value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {global && (
          <label className="label">
            Organizador
            <select name="org" defaultValue={org} className="field">
              <option value="">Todos</option>
              {organizers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="btn">
          Filtrar
        </button>
        {(q || org) && (
          <Link href="/compradores" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
            Limpiar
          </Link>
        )}
        <a href={exportHref} className="btn ml-auto">
          Exportar a Excel
        </a>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="eyebrow border-b border-[var(--border)]">
            <tr>
              <th className="px-4 py-3 font-normal">Comprador</th>
              <th className="px-4 py-3 text-right font-normal">Compras</th>
              <th className="px-4 py-3 text-right font-normal">Entradas</th>
              <th className="px-4 py-3 text-right font-normal">Total</th>
              <th className="px-4 py-3 font-normal">Última compra</th>
              <th className="px-4 py-3 font-normal">Eventos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--ink-muted)]">
                  {q || org ? "Ningún comprador con estos filtros." : "Todavía no hay compradores."}
                </td>
              </tr>
            )}
            {shown.map((b) => (
              <tr key={b.email} className="align-top">
                <td className="px-4 py-3">
                  <Link href={`/ordenes?q=${encodeURIComponent(b.email)}`} className="font-medium hover:text-[var(--accent)]">
                    {b.name}
                  </Link>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {[b.email, b.document && `CI ${b.document}`].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-xs text-[var(--ink-dim)]">
                    {b.channels.map((c) => CHANNEL_LABEL[c as keyof typeof CHANNEL_LABEL] ?? c).join(" + ")}
                  </p>
                </td>
                <td className="px-4 py-3 text-right font-mono">{b.orders}</td>
                <td className="px-4 py-3 text-right font-mono">{b.tickets}</td>
                <td className="px-4 py-3 text-right font-mono">{formatMoney(b.total, b.currency)}</td>
                <td className="px-4 py-3 text-xs text-[var(--ink-muted)]">{formatDateTime(b.lastPurchase, DEFAULT_TIMEZONE)}</td>
                <td className="px-4 py-3 text-xs text-[var(--ink-muted)]">
                  {b.events.slice(0, 3).join(", ")}
                  {b.events.length > 3 && ` y ${b.events.length - 3} más`}
                  {global && <p className="font-medium">{b.organizers.join(", ")}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > shown.length && (
          <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--ink-dim)]">
            Se muestran {shown.length} de {sorted.length}. La exportación a Excel trae a todos.
          </p>
        )}
      </div>
    </div>
  );
}
