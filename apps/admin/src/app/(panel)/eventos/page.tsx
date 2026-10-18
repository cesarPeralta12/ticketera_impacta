import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CATEGORY_LABEL, formatDateTime, sellableCapacity } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { EVENT_STATUS } from "@/lib/labels";
import { enterOrganizationAction } from "@/lib/actions/platform";
import { ROLES, isGlobalView, isNightlife, requireStaff } from "@/lib/session";
import { Help } from "@/components/help";

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
          ticketTypes: { select: { capacity: true, sectionId: true, peoplePerUnit: true, section: { select: { capacity: true, seatingMode: true } } } },
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
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {isGlobalView(staff) ? "Eventos de Impacta" : isNightlife(staff) ? "Noches" : "Eventos"}
            <Help title="Cómo se arma un evento">
              «+ Nuevo evento» abre el asistente: datos, lugar y fecha, entradas (con modelos General, VIP, Mesa, Free y
              Preventa), revisar con la vista previa del comprador y publicar. Para un evento chico que se vende con entradas
              impresas, «+ Evento pequeño» deja todo listo para imprimir en un paso.
            </Help>
          </h1>
        </div>
        {!staff.readOnly && (
          <div className="flex flex-wrap justify-end gap-2">
            {!isNightlife(staff) && (
              <Link href="/eventos/rapido" className="btn" title="Evento chico con entradas impresas para vender en mano">
                + Evento pequeño
              </Link>
            )}
            <Link href="/eventos/nuevo" className="btn btn-primary">
              {isNightlife(staff) ? "+ Nuevo boliche" : "+ Nuevo evento"}
            </Link>
          </div>
        )}
      </div>

      {events.length === 0 ? (
        <div className="card border-dashed p-8 text-center">
          <p className="font-medium">{isNightlife(staff) ? "Todavía no hay noches." : "Todavía no hay eventos."}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--ink-muted)]">
            {isNightlife(staff)
              ? "Se arma una vez: el boliche con su plano (Recintos), una noche con sus precios, y después se repite cada semana."
              : "El orden es: el recinto (una sola vez), el evento, sus fechas con precios y publicar."}
          </p>
          {!staff.readOnly && (
            <Link href="/eventos/nuevo" className="btn btn-primary mt-4 inline-flex">
              {isNightlife(staff) ? "Crear el primero" : "Crear el primer evento"}
            </Link>
          )}
        </div>
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
                      {event.small && <span className="badge bg-[var(--accent-soft)] text-[var(--accent)]">Pequeño</span>}
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
