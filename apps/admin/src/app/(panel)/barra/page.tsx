import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatDateTime, formatMoney } from "@ticketera/core";
import { type Prisma, prisma, salesAccess, sellableSessionsWhere } from "@ticketera/db";
import { FilterForm } from "@/components/filter-form";
import { PAGE_SIZE, Pager, pageFrom } from "@/components/pager";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Barra" };

/** Una noche sigue en la Barra hasta 12 h después de empezar (se consume durante la noche). */
const NIGHT_HOURS = 12;

export default async function BarPage({ searchParams }: { searchParams: Promise<{ q?: string; desde?: string; hasta?: string; pagina?: string }> }) {
  await connection();
  const staff = await requireStaff(ROLES.bar);
  const now = new Date();
  const access = await salesAccess(prisma, staff.id, staff.organization.id, now);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const isDay = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
  // Fechas escritas en la hora de Bolivia (UTC-4), dentro de la ventana de la barra (desde 12 h atrás hasta 14 días).
  const windowStart = new Date(now.getTime() - NIGHT_HOURS * 60 * 60_000);
  const windowEnd = new Date(now.getTime() + 14 * 24 * 60 * 60_000);
  const fromDay = isDay(sp.desde) ? new Date(`${sp.desde}T00:00:00-04:00`) : null;
  const toDay = isDay(sp.hasta) ? new Date(`${sp.hasta}T23:59:59-04:00`) : null;
  const where: Prisma.EventSessionWhereInput = {
    ...sellableSessionsWhere(access),
    cancelledAt: null,
    startsAt: { gt: fromDay && fromDay > windowStart ? fromDay : windowStart, lt: toDay && toDay < windowEnd ? toDay : windowEnd },
    event: { organizationId: staff.organization.id, status: "PUBLISHED" },
    // Solo noches con mesas o entradas con consumo incluido.
    ticketTypes: { some: { OR: [{ kind: "TABLE" }, { consumptionAmount: { gt: 0 } }] } },
    ...(q ? { OR: [{ event: { title: { contains: q, mode: "insensitive" } } }, { venue: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const total = await prisma.eventSession.count({ where });
  const page = pageFrom(sp.pagina, Math.ceil(total / PAGE_SIZE));
  const nights = await prisma.eventSession.findMany({
    where,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
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
      <FilterForm key={JSON.stringify(sp)}>
        <label className="label grow basis-56">
          Buscar una noche
          <input type="search" name="q" defaultValue={q} placeholder="Evento o recinto" className="field" autoComplete="off" />
        </label>
        <label className="label">
          Desde
          <input type="date" name="desde" defaultValue={sp.desde ?? ""} className="field" />
        </label>
        <label className="label">
          Hasta
          <input type="date" name="hasta" defaultValue={sp.hasta ?? ""} className="field" />
        </label>
      </FilterForm>

      {nights.length === 0 && (q || sp.desde || sp.hasta) ? (
        <p className="card p-6 text-center text-[var(--ink-muted)]">Ninguna noche coincide con la búsqueda.</p>
      ) : nights.length === 0 ? (
        <p className="card p-5 text-sm text-[var(--ink-muted)]">
          {access.all
            ? "No hay noches con consumo incluido en estos días. Se activan al cargar una mesa o una entrada con consumo en los precios de una noche."
            : "No tienes noches asignadas con consumo incluido en estos días. Pídele a iPass que te asigne las noches donde vas a cobrar."}
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
                    {started && <span className="badge bg-[var(--success-soft)] text-[var(--success)]">esta noche</span>}
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
      <Pager path="/barra" params={{ q, desde: sp.desde, hasta: sp.hasta }} page={page} total={total} />
    </div>
  );
}
