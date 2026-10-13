import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatDateTime, formatMoney } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Barra" };

/** Una noche sigue en la Barra hasta 12 h después de empezar (se consume durante la noche). */
const NIGHT_HOURS = 12;

export default async function BarPage() {
  await connection();
  const staff = await requireStaff(ROLES.pos);
  const now = new Date();
  const nights = await prisma.eventSession.findMany({
    where: {
      cancelledAt: null,
      startsAt: { gt: new Date(now.getTime() - NIGHT_HOURS * 60 * 60_000), lt: new Date(now.getTime() + 14 * 24 * 60 * 60_000) },
      event: { organizationId: staff.organization.id, status: "PUBLISHED" },
      // Solo noches con mesas o entradas con consumo incluido.
      ticketTypes: { some: { OR: [{ kind: "TABLE" }, { consumptionAmount: { gt: 0 } }] } },
    },
    orderBy: { startsAt: "asc" },
    include: { event: { select: { title: true } }, venue: { select: { name: true, timezone: true } } },
  });
  const totals = await prisma.consumptionCredit.groupBy({
    by: ["sessionId"],
    where: { sessionId: { in: nights.map((n) => n.id) } },
    _count: true,
    _sum: { amount: true, spent: true },
  });
  const bySession = new Map(totals.map((t) => [t.sessionId, t]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Barra</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Consumo incluido de mesas y lounges (consumo mínimo) y de entradas con trago. Elige la noche, lee el QR de
          cualquier persona de la mesa y descuenta lo que pidan: el saldo es compartido y nunca queda negativo.
        </p>
      </div>
      {nights.length === 0 ? (
        <p className="card p-5 text-sm text-[var(--ink-muted)]">
          No hay noches con consumo incluido en estos días. Se activan al cargar una mesa o una entrada con consumo en
          los precios de una noche.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {nights.map((n) => {
            const t = bySession.get(n.id);
            const started = n.startsAt <= now;
            return (
              <li key={n.id}>
                <Link
                  href={`/barra/${n.id}`}
                  className={`card block p-5 transition-colors hover:border-[var(--accent)] ${started ? "border-[var(--accent)]" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{n.event.title}</span>
                    {started && <span className="badge bg-[var(--accent-soft)] text-[var(--accent)]">esta noche</span>}
                  </span>
                  <span className="block text-sm capitalize text-[var(--ink-muted)]">
                    {formatDateTime(n.startsAt, n.venue.timezone)} · {n.venue.name}
                  </span>
                  <span className="mt-2 block font-mono text-xs text-[var(--ink-dim)]">
                    {t
                      ? `${t._count} saldo(s) · consumido ${formatMoney(t._sum.spent ?? 0, staff.organization.currency)} de ${formatMoney(t._sum.amount ?? 0, staff.organization.currency)}`
                      : "Sin mesas vendidas todavía"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
