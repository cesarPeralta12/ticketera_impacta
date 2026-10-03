import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CATEGORY_LABEL, DEFAULT_TIMEZONE, formatDateTime, sellableCapacity, utcToZonedInput } from "@ticketera/core";
import { clientAccessOpen, defaultClientAccessUntil, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { updateClientAccessAction } from "@/lib/actions/clients";
import {
  createSessionAction,
  publishEventAction,
  unpublishEventAction,
  updateEventAction,
} from "@/lib/actions/events";
import { EVENT_STATUS, MODE_LABEL } from "@/lib/labels";
import { ROLES, requireStaff } from "@/lib/session";
import { EventFields } from "../event-fields";

export const metadata: Metadata = { title: "Evento" };

type Props = { params: Promise<{ id: string }> };

export default async function EventDetailPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const event = await prisma.event.findFirst({
    where: { id: (await params).id, organizationId: staff.organization.id },
    include: {
      client: true,
      sessions: {
        where: { cancelledAt: null },
        orderBy: { startsAt: "asc" },
        include: {
          venue: true,
          ticketTypes: { select: { capacity: true, sectionId: true, section: { select: { capacity: true } } } },
          _count: { select: { tickets: { where: { status: { in: ["VALID", "USED"] } } } } },
        },
      },
    },
  });
  if (!event) notFound();

  const [venues, clients, suggestedUntil] = await Promise.all([
    prisma.venue.findMany({
      where: { organizationId: staff.organization.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true },
    }),
    prisma.client.findMany({
      where: { organizationId: staff.organization.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    defaultClientAccessUntil(event.id),
  ]);
  const status = EVENT_STATUS[event.status];
  const guestList = event.mode === "GUEST_LIST";
  const ready = event.sessions.length > 0 && event.sessions.every((s) => s.ticketTypes.length > 0);
  const tz = event.sessions[0]?.venue.timezone ?? DEFAULT_TIMEZONE;
  const accessOpen = clientAccessOpen(event);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/eventos" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ← Eventos
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{event.title}</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {CATEGORY_LABEL[event.category]} · {MODE_LABEL[event.mode]} ·{" "}
            {event.client ? `Cliente: ${event.client.name}` : "Evento propio"}
            {!guestList && (
              <>
                {" "}
                · <span className="font-mono">/{event.slug}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/eventos/${event.id}/reporte`} className="btn text-xs">
            Reporte
          </Link>
          <span className={`badge ${status.className}`}>{status.text}</span>
        </div>
      </div>

      <section className="card p-6">
        <h2 className="eyebrow mb-3">Publicación</h2>
        {event.status === "PUBLISHED" ? (
          <ActionForm action={unpublishEventAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="eventId" value={event.id} />
            <p className="text-sm text-[var(--ink-muted)]">
              {guestList
                ? "El evento está activo. Con lista de invitados no aparece en el sitio público: se entra solo con invitación."
                : "El evento está a la venta en el sitio público."}
            </p>
            <button type="submit" className="btn">
              Pasar a borrador
            </button>
          </ActionForm>
        ) : (
          <ActionForm action={publishEventAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="eventId" value={event.id} />
            <button type="submit" disabled={!ready} className="btn btn-primary">
              Publicar evento
            </button>
            {!ready && (
              <p className="text-sm text-[var(--ink-dim)]">
                {guestList
                  ? "Cada función necesita invitados cargados antes de activar el evento."
                  : "Cada función necesita al menos un tipo de entrada antes de publicar."}
              </p>
            )}
          </ActionForm>
        )}
      </section>

      <section className="card p-6">
        <h2 className="eyebrow mb-4">Funciones</h2>
        {event.sessions.length === 0 ? (
          <p className="mb-4 text-sm text-[var(--ink-muted)]">
            Agrega al menos una función (fecha, hora y recinto) y cárgale entradas.
          </p>
        ) : (
          <ul className="mb-5 flex flex-col gap-2">
            {event.sessions.map((s) => {
              const capacity = sellableCapacity(s.ticketTypes);
              return (
                <li key={s.id}>
                  <Link
                    href={`/eventos/${event.id}/funciones/${s.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--accent)]"
                  >
                    <span>
                      <span className="font-mono">{formatDateTime(s.startsAt, s.venue.timezone)}</span>
                      <span className="text-[var(--ink-muted)]"> · {s.venue.name}</span>
                      {s.queueEnabled && <span className="badge ml-2 bg-[var(--warn-soft)] text-[var(--warn)]">cola</span>}
                    </span>
                    <span className={s.ticketTypes.length ? "text-[var(--accent)]" : "text-[var(--warn)]"}>
                      {guestList
                        ? s.ticketTypes.length
                          ? `${s._count.tickets} invitado(s)`
                          : "Falta cargar invitados"
                        : s.ticketTypes.length
                          ? `${s._count.tickets} / ${capacity} vendidas`
                          : "Falta cargar entradas"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {venues.length === 0 ? (
          <p className="text-sm">
            Primero <Link href="/recintos" className="text-[var(--accent)] underline">crea un recinto</Link>.
          </p>
        ) : (
          <ActionForm action={createSessionAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="eventId" value={event.id} />
            <label className="label">
              Recinto
              <select name="venueId" required className="field">
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.city ? ` (${v.city})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Inicio del evento
              <input type="datetime-local" name="startsAt" required className="field" />
            </label>
            <label className="label">
              Apertura de puertas (opcional)
              <input type="datetime-local" name="doorsOpenAt" className="field" />
            </label>
            <button type="submit" className="btn btn-dark">
              Agregar función
            </button>
            <p className="basis-full text-xs text-[var(--ink-dim)]">
              <strong>Inicio del evento:</strong> cuando empieza el show. <strong>Apertura de puertas:</strong> desde
              qué hora puede entrar la gente (antes del inicio). Ambas en la hora local del recinto. La venta de
              entradas se abre al publicar el evento.
            </p>
          </ActionForm>
        )}
      </section>

      <section className="card p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="eyebrow">Espacio del cliente</h2>
          {event.client &&
            (accessOpen ? (
              <span className="badge bg-[var(--accent-soft)] text-[var(--accent)]">
                Abierto hasta {formatDateTime(event.clientAccessUntil!, tz)}
              </span>
            ) : (
              <span className="badge bg-[var(--surface-2)] text-[var(--ink-dim)]">Cerrado</span>
            ))}
        </div>
        {!event.client ? (
          <p className="text-sm text-[var(--ink-muted)]">
            Es un evento propio. Para que un organizador lo siga, asígnale un cliente en &ldquo;Editar datos del
            evento&rdquo;.
          </p>
        ) : (
          <ActionForm action={updateClientAccessAction} successMessage="Guardado." className="flex flex-wrap items-end gap-4">
            <input type="hidden" name="eventId" value={event.id} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={event.clientAccessEnabled} className="h-4 w-4" />
              {event.client.name} puede ver ventas, ingresos y reportes de este evento
            </label>
            <label className="label">
              Hasta
              <input
                type="datetime-local"
                name="until"
                defaultValue={utcToZonedInput(event.clientAccessUntil ?? suggestedUntil, tz)}
                className="field"
              />
            </label>
            <button type="submit" className="btn btn-dark">
              Guardar
            </button>
            <p className="basis-full text-xs text-[var(--ink-dim)]">
              Es temporal: se cierra sola en esa fecha (por defecto, 24 h después de la última función). Las cuentas del
              cliente se crean en Usuarios con el rol &ldquo;Cliente / organizador&rdquo;.
            </p>
          </ActionForm>
        )}
      </section>

      <details className="card p-6">
        <summary className="cursor-pointer text-sm font-medium">Editar datos del evento</summary>
        <ActionForm action={updateEventAction} successMessage="Cambios guardados." className="mt-5 flex flex-col gap-5">
          <input type="hidden" name="eventId" value={event.id} />
          <EventFields defaults={event} clients={clients} />
          <button type="submit" className="btn btn-primary w-fit">
            Guardar cambios
          </button>
        </ActionForm>
      </details>
    </div>
  );
}
