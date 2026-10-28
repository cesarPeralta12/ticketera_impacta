import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime, formatMoney, formatTime, tableLabel } from "@ticketera/core";
import { nightConsumption, prisma } from "@ticketera/db";
import { staffCanSell } from "@/lib/sales-access";
import { ROLES, requireStaff } from "@/lib/session";
import { BarTerminal } from "./bar-terminal";

export const metadata: Metadata = { title: "Barra" };

type Props = { params: Promise<{ sessionId: string }> };

export default async function BarNightPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.pos);
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
        <h2 className="eyebrow mb-3">Consumo de la noche</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-sm text-[var(--ink-muted)]">Incluido en mesas y entradas</p>
            <p className="font-mono text-xl">{formatMoney(summary.amount, currency)}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--ink-muted)]">Consumido</p>
            <p className="font-mono text-xl text-[var(--accent)]">{formatMoney(summary.spent, currency)}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--ink-muted)]">Saldo sin usar</p>
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
                <th className="py-2 text-right font-normal">Consumido</th>
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

      <section className="card p-6">
        <h2 className="eyebrow mb-3">Últimos consumos</h2>
        {summary.recent.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">Todavía no se cobró nada esta noche.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {summary.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {formatTime(r.createdAt, tz)} ·{" "}
                  {tableLabel(r.credit.ticketType.name, r.credit.tableNumber, r.credit.seat?.label) ?? r.credit.ticketType.name} · {r.staff.name}
                  {r.note && <span className="text-[var(--ink-dim)]"> · {r.note}</span>}
                </span>
                <span className="font-mono">−{formatMoney(r.amount, currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
