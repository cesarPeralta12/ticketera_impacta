import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatDateTime } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Control de acceso" };

/** Funciones de las últimas 24 horas en adelante (incluye la que está en curso). */
function controllableSince() {
  return new Date(Date.now() - 24 * 60 * 60_000);
}

export default async function AccessIndexPage() {
  await connection();
  const { organization: org } = await requireStaff(ROLES.access);
  const sessions = await prisma.eventSession.findMany({
    where: { event: { organizationId: org.id, status: "PUBLISHED" }, cancelledAt: null, startsAt: { gte: controllableSince() } },
    orderBy: { startsAt: "asc" },
    include: {
      event: true,
      venue: true,
      _count: { select: { tickets: { where: { status: { in: ["VALID", "USED"] } } } } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Control de acceso</h1>
        <p className="text-sm text-[var(--ink-muted)]">Elige la función que se está controlando en puerta.</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {sessions.map((session) => (
          <li key={session.id}>
            <Link
              href={`/acceso/${session.id}`}
              className="block card p-5 hover:border-[var(--accent)]"
            >
              <p className="font-semibold">{session.event.title}</p>
              <p className="text-sm text-[var(--ink-muted)]">
                {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name}
              </p>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">{session._count.tickets} entradas emitidas</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
