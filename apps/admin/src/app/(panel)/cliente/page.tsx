import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatDateTime } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { MODE_LABEL } from "@/lib/labels";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Mis eventos" };

/** Eventos del cliente con el espacio abierto ahora, con lo emitido y lo ingresado. */
async function openEvents(organizationId: string, clientId: string) {
  const events = await prisma.event.findMany({
    where: { organizationId, clientId, clientAccessEnabled: true, clientAccessUntil: { gt: new Date() } },
    include: {
      sessions: {
        where: { cancelledAt: null },
        orderBy: { startsAt: "asc" },
        include: { venue: { select: { name: true, timezone: true } } },
      },
    },
  });
  return Promise.all(
    events.map(async (event) => {
      const tickets = { session: { eventId: event.id, cancelledAt: null } };
      const [issued, used] = await Promise.all([
        prisma.ticket.count({ where: { ...tickets, status: { in: ["VALID", "USED"] } } }),
        prisma.ticket.count({ where: { ...tickets, status: "USED" } }),
      ]);
      return { ...event, issued, used };
    }),
  );
}

export default async function ClientHomePage() {
  await connection();
  const staff = await requireStaff(ROLES.client);
  if (!staff.client) {
    return <p className="text-sm text-[var(--ink-muted)]">Tu cuenta no está asociada a un cliente. Pide a IMPACTA que la revise.</p>;
  }
  const events = await openEvents(staff.organization.id, staff.client.id);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{staff.client.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Mis eventos</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Ventas, ingresos y reportes de tus eventos con IMPACTA. El acceso es temporal: IMPACTA lo habilita por evento y
          se cierra solo después del evento.
        </p>
      </div>

      {events.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--ink-muted)]">
          No tienes eventos con el acceso abierto en este momento.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {events.map((e) => {
            const first = e.sessions[0];
            return (
              <li key={e.id}>
                <Link href={`/cliente/${e.id}`} className="card block p-5 transition-colors hover:border-[var(--accent)]">
                  <p className="font-medium">{e.title}</p>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {first ? `${formatDateTime(first.startsAt, first.venue.timezone)} · ${first.venue.name}` : "Sin funciones"}
                    {e.sessions.length > 1 && ` (+${e.sessions.length - 1})`}
                  </p>
                  <p className="eyebrow mt-2">
                    {MODE_LABEL[e.mode]} · {e.issued} {e.mode === "GUEST_LIST" ? "invitados" : "entradas"} · {e.used}{" "}
                    ingresaron
                  </p>
                  {e.clientAccessUntil && first && (
                    <p className="mt-1 text-xs text-[var(--ink-dim)]">
                      Acceso hasta {formatDateTime(e.clientAccessUntil, first.venue.timezone)}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
