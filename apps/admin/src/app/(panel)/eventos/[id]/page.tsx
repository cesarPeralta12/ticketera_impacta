import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  CATEGORY_LABEL,
  DEFAULT_TIMEZONE,
  MAX_REPEAT_WEEKS,
  WEEKDAY_SHORT,
  formatClock,
  formatDateTime,
  sellableCapacity,
  sessionNoun,
  suggestedTimes,
  utcToZonedInput,
} from "@ticketera/core";
import { clientAccessOpen, defaultClientAccessUntil, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { updateClientAccessAction } from "@/lib/actions/clients";
import { repeatNightsAction } from "@/lib/actions/nightlife";
import {
  createSessionAction,
  duplicateSessionAction,
  publishEventAction,
  unpublishEventAction,
  updateEventAction,
} from "@/lib/actions/events";
import { SessionTimesFields } from "@/components/session-times-fields";
import { EVENT_STATUS, MODE_LABEL } from "@/lib/labels";
import { ROLES, allowedCategories, requireStaff } from "@/lib/session";
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
          ticketTypes: { select: { capacity: true, sectionId: true, peoplePerUnit: true, section: { select: { capacity: true, seatingMode: true } } } },
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
      select: { id: true, name: true, city: true, timezone: true },
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
  // "Clientes" es el modo en que Impacta opera el evento para otro: solo en la organización de Impacta.
  const clientMode = staff.organization.isPlatform;
  // Un organizador no publica: envía a revisión y Impacta aprueba.
  const needsReview = !staff.platform;
  const nightlife = event.category === "BOLICHE";
  const noun = sessionNoun(event.category);
  const priced = event.sessions.filter((s) => s.ticketTypes.length > 0);
  const lastPriced = priced.at(-1);
  // "Nueva noche": por defecto, una semana después de la última noche armada.
  const nextWeek = lastPriced
    ? utcToZonedInput(new Date(lastPriced.startsAt.getTime() + 7 * 86_400_000), lastPriced.venue.timezone).slice(0, 10)
    : undefined;

  // Lo que falta para publicar: lo obligatorio frena el botón; lo recomendado solo avisa.
  const missingPrices = event.sessions.find((s) => s.ticketTypes.length === 0);
  const missingEnd = event.sessions.find((s) => !s.endsAt);
  const sessionHref = (id: string) => `/eventos/${event.id}/funciones/${id}`;
  const checks = [
    { done: venues.length > 0, required: true, text: "Un recinto", href: "/recintos", action: "Crear recinto" },
    { done: event.sessions.length > 0, required: true, text: `${noun.One} con día y hora`, href: "#funciones", action: `Agregar ${noun.one}` },
    {
      done: event.sessions.length > 0 && !missingPrices,
      required: true,
      text: guestList ? `Invitados en cada ${noun.one}` : `Precios en cada ${noun.one}`,
      href: missingPrices ? `${sessionHref(missingPrices.id)}${guestList ? "/invitados" : ""}` : "#funciones",
      action: guestList ? "Cargar invitados" : "Cargar precios",
    },
    ...(guestList
      ? []
      : [
          { done: Boolean(event.imageUrl), required: false, text: "Imagen del evento", href: "#datos", action: "Agregar" },
          { done: Boolean(event.description?.trim()), required: false, text: "Descripción", href: "#datos", action: "Escribir" },
        ]),
    {
      done: event.sessions.length > 0 && !missingEnd,
      required: false,
      text: `Hora de fin de cada ${noun.one}`,
      href: missingEnd ? `${sessionHref(missingEnd.id)}#horarios` : "#funciones",
      action: "Ponerla",
    },
  ];
  const doneCount = checks.filter((c) => c.done).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/eventos" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ← Eventos
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{event.title}</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {CATEGORY_LABEL[event.category]} · {MODE_LABEL[event.mode]}
            {clientMode && <> · {event.client ? `Cliente: ${event.client.name}` : "Evento propio"}</>}
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

      {event.reviewNote && event.status === "DRAFT" && (
        <div role="alert" className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-5 py-4 text-sm">
          <p className="font-semibold text-[var(--warn)]">Impacta devolvió este evento</p>
          <p className="mt-1">{event.reviewNote}</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">Corrígelo y vuelve a enviarlo a revisión.</p>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <section id="funciones" className="card scroll-mt-6 p-6">
            <h2 className="eyebrow mb-4">{noun.Many}</h2>
            {event.sessions.length === 0 ? (
              <p className="mb-4 text-sm text-[var(--ink-muted)]">
                Todavía no hay {noun.many}. Agrega {noun.a} con su día y hora y después cárgale los precios.
              </p>
            ) : (
              <ul className="mb-5 flex flex-col gap-2">
                {event.sessions.map((s) => {
                  const capacity = sellableCapacity(s.ticketTypes);
                  return (
                    <li key={s.id}>
                      <Link
                        href={sessionHref(s.id)}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-4 py-3 text-sm transition-colors hover:border-[var(--accent)]"
                      >
                        <span>
                          <span className="font-mono">{formatDateTime(s.startsAt, s.venue.timezone)}</span>
                          {s.endsAt && <span className="font-mono text-[var(--ink-muted)]"> → {formatClock(s.endsAt, s.venue.timezone)}</span>}
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
                              : "Falta cargar precios"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            {venues.length === 0 ? (
              <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm">
                <p>
                  Para agregar {noun.a} primero necesitas un <strong>recinto</strong>: el lugar, con su mapa de secciones. Se
                  arma una sola vez y sirve para todos los eventos.
                </p>
                <Link href="/recintos" className="btn btn-dark mt-3 inline-flex">
                  Crear el recinto
                </Link>
              </div>
            ) : (
              <>
                {nightlife && lastPriced && (
                  <ActionForm action={duplicateSessionAction} className="mb-4 flex flex-wrap items-end gap-3 rounded-md bg-[var(--surface-2)] p-4">
                    <p className="basis-full text-sm font-medium">Nueva noche</p>
                    <label className="label">
                      Copiar
                      <select name="sessionId" defaultValue={lastPriced.id} className="field">
                        {priced.map((s) => (
                          <option key={s.id} value={s.id}>
                            {formatDateTime(s.startsAt, s.venue.timezone)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="label">
                      Día de la nueva noche
                      <input type="date" name="date" required defaultValue={nextWeek} className="field" />
                    </label>
                    <button type="submit" className="btn btn-dark">
                      Crear noche
                    </button>
                    <p className="basis-full text-xs text-[var(--ink-dim)]">
                      Copia sus horarios, precios, mesas, free y porteros. Después ajusta lo que cambie (artista, precio,
                      preventa).
                    </p>
                  </ActionForm>
                )}
                <details open={!(nightlife && lastPriced)} className="group">
                  <summary className="mb-3 cursor-pointer text-sm font-medium text-[var(--accent)] group-open:text-[var(--ink)]">
                    {nightlife && lastPriced ? "O crear una noche vacía" : `Agregar ${noun.one}`}
                  </summary>
                  <ActionForm action={createSessionAction} resetOnSuccess className="flex flex-col gap-4">
                    <input type="hidden" name="eventId" value={event.id} />
                    <SessionTimesFields category={event.category} venues={venues} defaults={suggestedTimes(event.category)} />
                    <button type="submit" className="btn btn-dark w-fit">
                      Agregar {noun.one}
                    </button>
                  </ActionForm>
                </details>
              </>
            )}
          </section>

          {nightlife && lastPriced && (
            <section className="card p-6">
              <h2 className="eyebrow mb-1">Repetir noches</h2>
              <p className="mb-4 text-sm text-[var(--ink-muted)]">
                Varias semanas de una vez: copia una noche a los días que abre el boliche, cada una con su propio cupo. No
                repite noches que ya existen.
              </p>
              <ActionForm action={repeatNightsAction} className="flex flex-wrap items-end gap-3">
                <label className="label">
                  Copiar la noche
                  <select name="sessionId" required defaultValue={lastPriced.id} className="field">
                    {priced.map((s) => (
                      <option key={s.id} value={s.id}>
                        {formatDateTime(s.startsAt, s.venue.timezone)}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="label">
                  Días que abre
                  <span className="flex h-[38px] flex-wrap items-center gap-3">
                    {[4, 5, 6, 0, 1, 2, 3].map((d) => (
                      <label key={d} className="flex items-center gap-1 text-sm">
                        <input type="checkbox" name="weekday" value={d} defaultChecked={d === 5 || d === 6} className="h-4 w-4" />
                        {WEEKDAY_SHORT[d]}
                      </label>
                    ))}
                  </span>
                </fieldset>
                <label className="label">
                  Semanas
                  <input name="weeks" type="number" min={1} max={MAX_REPEAT_WEEKS} defaultValue={4} className="field w-24" />
                </label>
                <button type="submit" className="btn btn-dark">
                  Crear noches
                </button>
              </ActionForm>
            </section>
          )}

          {clientMode && (
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
          )}

          <section id="datos" className="card scroll-mt-6 p-6">
            <h2 className="eyebrow mb-4">Datos del evento</h2>
            <ActionForm action={updateEventAction} successMessage="Cambios guardados." className="flex flex-col gap-5">
              <input type="hidden" name="eventId" value={event.id} />
              <EventFields defaults={event} clients={clientMode ? clients : null} categories={allowedCategories(staff)} />
              <button type="submit" className="btn btn-primary w-fit">
                Guardar cambios
              </button>
            </ActionForm>
          </section>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6">
          <section className="card p-5">
            <h2 className="eyebrow mb-1">Publicación</h2>
            <p className="mb-3 text-xs text-[var(--ink-muted)]">
              {doneCount} de {checks.length} listos
            </p>
            <ul className="mb-4 space-y-2 text-sm">
              {checks.map((c) => (
                <li key={c.text} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      c.done
                        ? "bg-[var(--accent)] text-white"
                        : c.required
                          ? "border border-[var(--warn)] text-[var(--warn)]"
                          : "border border-[var(--border)] text-[var(--ink-dim)]"
                    }`}
                  >
                    {c.done ? "✓" : c.required ? "!" : ""}
                  </span>
                  <span className="flex-1">
                    <span className={c.done ? "text-[var(--ink-muted)]" : ""}>{c.text}</span>
                    {!c.done && (
                      <>
                        <span className="text-xs text-[var(--ink-dim)]"> · {c.required ? "falta" : "recomendado"}</span>
                        {/* Una cuenta de solo lectura ve qué falta, pero lo completa Impacta. */}
                        {!staff.readOnly && (
                          <>
                            <span className="text-xs text-[var(--ink-dim)]"> · </span>
                            <Link href={c.href} className="text-xs text-[var(--accent)] hover:underline">
                              {c.action}
                            </Link>
                          </>
                        )}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {event.status === "PENDING_REVIEW" ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-[var(--ink-muted)]">
                  {needsReview
                    ? "Enviado a Impacta. Sale en la web cuando lo aprueben; si piden cambios, los verás aquí."
                    : "El organizador lo envió a revisión. Apruébalo aquí, o devuélvelo con observaciones desde Aprobaciones."}
                </p>
                {!needsReview && (
                  <ActionForm action={publishEventAction}>
                    <input type="hidden" name="eventId" value={event.id} />
                    <button type="submit" className="btn btn-primary">
                      Aprobar y publicar
                    </button>
                  </ActionForm>
                )}
                {needsReview && (
                  <ActionForm action={unpublishEventAction}>
                    <input type="hidden" name="eventId" value={event.id} />
                    <button type="submit" className="btn">
                      Retirar de revisión
                    </button>
                  </ActionForm>
                )}
              </div>
            ) : event.status === "PUBLISHED" ? (
              <ActionForm action={unpublishEventAction} className="flex flex-col gap-3">
                <input type="hidden" name="eventId" value={event.id} />
                <p className="text-sm text-[var(--ink-muted)]">
                  {guestList
                    ? "El evento está activo. Con lista de invitados no aparece en el sitio público: se entra solo con invitación."
                    : "El evento está a la venta en el sitio público."}
                </p>
                <button type="submit" className="btn w-fit">
                  Pasar a borrador
                </button>
              </ActionForm>
            ) : (
              <ActionForm action={publishEventAction} className="flex flex-col gap-2">
                <input type="hidden" name="eventId" value={event.id} />
                <button type="submit" disabled={!ready} className="btn btn-primary w-full">
                  {needsReview ? "Enviar a revisión" : guestList ? "Activar evento" : "Publicar evento"}
                </button>
                <p className="text-xs text-[var(--ink-dim)]">
                  {!ready
                    ? "Completa lo marcado con ! para poder publicar."
                    : needsReview
                      ? "Impacta lo revisa y lo publica en la web."
                      : guestList
                        ? "Con lista de invitados no aparece en el sitio: se entra solo con invitación."
                        : "Sale a la venta en el sitio apenas lo publiques."}
                </p>
              </ActionForm>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
