import Link from "next/link";
import { connection } from "next/server";
import { formatDateTime, formatMoney, sellableCapacity } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { CountUp } from "@/components/count-up";
import { GlobalDashboard } from "@/components/global-dashboard";
import { ROLES, isGlobalView, isNightlife, requireStaff } from "@/lib/session";
import { CreateEventCta } from "@/components/create-event-cta";

export default async function DashboardPage() {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  // Impacta en su propia organización ve a todos los organizadores juntos.
  if (isGlobalView(staff)) return <GlobalDashboard name={staff.name} />;
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
        ticketTypes: { select: { capacity: true, sectionId: true, peoplePerUnit: true, section: { select: { capacity: true, seatingMode: true } } } },
        _count: { select: { tickets: { where: { status: { in: ["VALID", "USED"] } } } } },
      },
    }),
  ]);

  // Color según la función: ámbar = a la venta o pendiente, azul = conteos, magenta = dinero.
  const stats = [
    { label: isNightlife(staff) ? "Noches publicadas" : "Eventos publicados", value: published, tone: "amber" },
    { label: "Borradores", value: drafts, tone: "blue" },
    { label: "Entradas vendidas", value: ticketsSold, tone: "blue" },
    { label: "Ingresos", value: formatMoney(revenue._sum.totalAmount ?? 0, org.currency), tone: "magenta" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Hola, {staff.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Resumen</h1>
        </div>
        {/* En un boliche, lo más común es crear la noche: queda a la vista desde el Resumen. */}
        {isNightlife(staff) && <CreateEventCta staff={staff} />}
      </div>

      <dl className="stats grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`card tone-${s.tone} p-4`}>
            <dt className="eyebrow">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{typeof s.value === "number" ? <CountUp value={s.value} /> : s.value}</dd>
          </div>
        ))}
      </dl>

      <section className="card">
        <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">{isNightlife(staff) ? "Próximas noches" : "Próximas funciones"}</h2>
        {nextSessions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">
            {isNightlife(staff) ? "No hay noches programadas." : "No hay funciones programadas."}{" "}
            <Link href="/eventos" className="text-[var(--accent)] hover:underline">
              {isNightlife(staff) ? "Ir a noches" : "Ir a eventos"}
            </Link>
          </p>
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
