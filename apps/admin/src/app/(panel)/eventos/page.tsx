import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CATEGORY_LABEL, formatDateTime, sellableCapacity } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { EVENT_STATUS } from "@/lib/labels";
import { ROLES, requireStaff } from "@/lib/session";

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

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{events.length} evento(s)</p>
          <h1 className="text-2xl font-semibold tracking-tight">Eventos</h1>
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
    </div>
  );
}
