import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CATEGORY_LABEL, formatDateTime, sellableCapacity } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { EVENT_STATUS } from "@/lib/labels";
import { enterOrganizationAction } from "@/lib/actions/platform";
import { ROLES, isGlobalView, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Eventos" };

export default async function EventsPage() {
  await connection();
  const staff = await requireStaff(ROLES.manage);

  const events = await prisma.event.findMany({
    where: { organizationId: staff.organization.id },
    orderBy: { createdAt: "desc" },
    include: {
      sessions: {
        where: { cancelledAt: null },
        orderBy: { startsAt: "asc" },
        include: {
          venue: { select: { name: true, timezone: true } },
          ticketTypes: { select: { capacity: true, sectionId: true, section: { select: { capacity: true } } } },
          _count: { select: { tickets: { where: { status: { in: ["VALID", "USED"] } } } } },
        },
      },
    },
  });
  // Impacta ve también los eventos de todos los organizadores (para abrirlos, entra en el organizador).
  const others = isGlobalView(staff)
    ? await prisma.event.findMany({
        where: { organizationId: { not: staff.organization.id } },
        orderBy: [{ organization: { name: "asc" } }, { createdAt: "desc" }],
        include: {
          organization: { select: { id: true, name: true } },
          sessions: {
            where: { cancelledAt: null },
            orderBy: { startsAt: "asc" },
            take: 1,
            include: { venue: { select: { name: true, timezone: true } } },
          },
        },
      })
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{events.length} evento(s)</p>
          <h1 className="text-2xl font-semibold tracking-tight">{isGlobalView(staff) ? "Eventos de Impacta" : "Eventos"}</h1>
        </div>
        <Link href="/eventos/nuevo" className="btn btn-primary">
          + Nuevo evento
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-[var(--ink-muted)]">Todavía no hay eventos.</div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {events.map((event) => {
            const [first] = event.sessions;
            const capacity = event.sessions.reduce((sum, s) => sum + sellableCapacity(s.ticketTypes), 0);
            const sold = event.sessions.reduce((sum, s) => sum + s._count.tickets, 0);
            const status = EVENT_STATUS[event.status];
            return (
              <li key={event.id}>
                <Link
                  href={`/eventos/${event.id}`}
                  className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4 transition-colors hover:border-[var(--accent)]"
                >
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-medium">{event.title}</span>
                      <span className={`badge ${status.className}`}>{status.text}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
                      {CATEGORY_LABEL[event.category]}
                      {first && ` · ${first.venue.name}`}
                    </p>
                  </div>
                  <div className="text-right font-mono text-xs text-[var(--ink-dim)]">
                    <p>
                      {event.sessions.length === 0
                        ? "sin funciones"
                        : `${event.sessions.length} función(es) · ${formatDateTime(first!.startsAt, first!.venue.timezone)}`}
                    </p>
                    <p>
                      {sold} / {capacity} vendidas
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {isGlobalView(staff) && (
        <section className="space-y-2">
          <h2 className="eyebrow">De los organizadores ({others.length})</h2>
          {others.length === 0 ? (
            <p className="card p-5 text-sm text-[var(--ink-muted)]">Los organizadores todavía no cargaron eventos.</p>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-[var(--border)]">
                  {others.map((event) => {
                    const first = event.sessions[0];
                    const status = EVENT_STATUS[event.status];
                    return (
                      <tr key={event.id}>
                        <td className="px-5 py-3">
                          <p className="font-medium">{event.title}</p>
                          <p className="text-xs text-[var(--ink-dim)]">
                            {event.organization.name}
                            {first && ` · ${formatDateTime(first.startsAt, first.venue.timezone)} · ${first.venue.name}`}
                          </p>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`badge ${status.className}`}>{status.text}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <form action={enterOrganizationAction}>
                            <input type="hidden" name="organizationId" value={event.organization.id} />
                            <input type="hidden" name="next" value={`/eventos/${event.id}`} />
                            <button type="submit" className="btn text-xs">
                              Abrir
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
