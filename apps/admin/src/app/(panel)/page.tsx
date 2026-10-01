import Link from "next/link";
import { connection } from "next/server";
import { formatDateTime, formatMoney, sellableCapacity } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { ROLES, requireStaff } from "@/lib/session";

export default async function DashboardPage() {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const org = staff.organization;
  const byOrg = { event: { organizationId: org.id } };

  const [published, drafts, ticketsSold, revenue, nextSessions] = await Promise.all([
    prisma.event.count({ where: { organizationId: org.id, status: "PUBLISHED" } }),
    prisma.event.count({ where: { organizationId: org.id, status: "DRAFT" } }),
    prisma.ticket.count({ where: { status: { in: ["VALID", "USED"] }, session: byOrg } }),
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { status: "PAID", currency: org.currency, items: { some: { ticketType: { session: byOrg } } } },
    }),
    prisma.eventSession.findMany({
      where: { ...byOrg, cancelledAt: null, startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 6,
      include: {
        event: { select: { id: true, title: true, status: true } },
        venue: { select: { name: true, timezone: true } },
        ticketTypes: { select: { capacity: true, sectionId: true, section: { select: { capacity: true } } } },
        _count: { select: { tickets: { where: { status: { in: ["VALID", "USED"] } } } } },
      },
    }),
  ]);

  const stats = [
    { label: "Eventos publicados", value: published },
    { label: "Borradores", value: drafts },
    { label: "Entradas vendidas", value: ticketsSold },
    { label: "Ingresos", value: formatMoney(revenue._sum.totalAmount ?? 0, org.currency) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Hola, {staff.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Resumen</h1>
      </div>

      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <dt className="eyebrow">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      <section className="card">
        <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">Próximas funciones</h2>
        {nextSessions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">No hay funciones programadas.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {nextSessions.map((session) => {
              const capacity = sellableCapacity(session.ticketTypes);
              return (
                <li key={session.id}>
                  <Link
                    href={`/eventos/${session.event.id}/funciones/${session.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-[var(--surface-2)]"
                  >
                    <div>
                      <p className="font-medium">
                        {session.event.title}
                        {session.event.status === "DRAFT" && (
                          <span className="badge ml-2 bg-[var(--warn-soft)] text-[var(--warn)]">borrador</span>
                        )}
                      </p>
                      <p className="text-sm text-[var(--ink-muted)]">
                        {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name}
                      </p>
                    </div>
                    <p className="font-mono text-sm text-[var(--ink-muted)]">
                      {session._count.tickets} / {capacity} vendidas
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
