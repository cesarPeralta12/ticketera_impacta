import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  CATEGORY_LABEL,
  DEFAULT_TIMEZONE,
  formatMoney,
  MAX_REPEAT_WEEKS,
  WEEKDAY_SHORT,
  formatClock,
  formatDateTime,
  sellableCapacity,
  sessionNoun,
  suggestedTimes,
  utcToZonedInput,
} from "@ticketera/core";
import { clientAccessOpen, defaultClientAccessUntil, getEventReport, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { EventChecklist } from "@/components/event-checklist";
import { EventReport } from "@/components/event-report";
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
import { eventChecks } from "@/lib/event-checklist";
import { EVENT_STATUS, MODE_LABEL } from "@/lib/labels";
import { buyerPreviewUrl } from "@/lib/preview";
import { ROLES, allowedCategories, requireStaff } from "@/lib/session";
import { EventFields } from "../event-fields";

export const metadata: Metadata = { title: "Evento" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> };

const TABS = [
  { key: "resumen", label: "Resumen" },
  { key: "funciones", label: "Funciones" },
  { key: "ventas", label: "Ventas" },
  { key: "configuracion", label: "Configuración" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function EventDetailPage({ params, searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const requested = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.key === requested) ? (requested as Tab) : "resumen";
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
  const checks = eventChecks(event, venues.length);
  const sessionHref = (id: string) => `/eventos/${event.id}/funciones/${id}`;
  const tabHref = (key: Tab) => `/eventos/${event.id}${key === "resumen" ? "" : `?tab=${key}`}`;
  // Siguiente paso del asistente para un borrador: lugar y fecha, entradas o revisar.
  const wizardStep = event.sessions.length === 0 ? "lugar" : !ready ? "entradas" : "revisar";
  const [report, previewUrl] = await Promise.all([
    tab === "resumen" || tab === "ventas" ? getEventReport(event.id) : null,
    event.mode === "TICKETING" ? buyerPreviewUrl(event.id) : null,
  ]);
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
        <div className="flex flex-wrap items-center gap-2">
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noreferrer" className="btn text-xs" title="La página del evento como la ve el comprador (aunque esté en borrador)">
              Vista previa ↗
            </a>
          )}
          {!staff.readOnly && event.sessions.length > 0 && (
            <Link href={`/eventos/${event.id}/importar`} className="btn text-xs" title="Cargar entradas vendidas por otro medio o cortesías desde una planilla">
              Importar Excel
            </Link>
          )}
          <Link href={`/eventos/${event.id}/reporte`} className="btn text-xs">
            Reporte
          </Link>
          <span className={`badge ${status.className}`}>{status.text}</span>
        </div>
      </div>

      {event.reviewNote && event.status === "DRAFT" && (
        <div role="alert" className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-5 py-4 text-sm">
          <p className="font-semibold text-[var(--warn)]">iPass devolvió este evento</p>
          <p className="mt-1">{event.reviewNote}</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">Corrígelo y vuelve a enviarlo a revisión.</p>
        </div>
      )}

      <nav aria-label="Secciones del evento" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-[var(--border)]">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm ${
              tab === t.key ? "border-[var(--accent)] font-semibold text-[var(--ink)]" : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          {tab === "resumen" && report && (
            <>
              {event.status === "DRAFT" && !staff.readOnly && (
                <Link
                  href={`/eventos/${event.id}/asistente/${wizardStep}`}
                  className="card flex flex-wrap items-center justify-between gap-3 border-[var(--accent)] p-5 transition-colors hover:bg-[var(--accent-soft)]"
                >
                  <span>
                    <span className="block font-medium">Sigue armándolo con el asistente</span>
                    <span className="text-sm text-[var(--ink-muted)]">
                      Lugar y fecha → entradas → revisar (con la vista previa del comprador) → publicar.
                    </span>
                  </span>
                  <span className="font-mono text-sm text-[var(--accent)]">Continuar →</span>
                </Link>
              )}
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="card p-4">
                  <dt className="text-xs text-[var(--ink-dim)]">{noun.Many}</dt>
                  <dd className="mt-1 text-2xl font-semibold">{event.sessions.length}</dd>
                </div>
                <div className="card p-4">
                  <dt className="text-xs text-[var(--ink-dim)]">Entradas emitidas</dt>
                  <dd className="mt-1 text-2xl font-semibold">{report.issued}</dd>
                </div>
                <div className="card p-4">
                  <dt className="text-xs text-[var(--ink-dim)]">Ya ingresaron</dt>
                  <dd className="mt-1 text-2xl font-semibold">{report.used}</dd>
                </div>
                <div className="card p-4">
                  <dt className="text-xs text-[var(--ink-dim)]">Recaudación</dt>
                  <dd className="mt-1 text-2xl font-semibold">{formatMoney(report.revenue, report.currency)}</dd>
                </div>
              </dl>
              <section className="card p-6">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="eyebrow">{noun.Many}</h2>
                  <Link href={tabHref("funciones")} className="text-sm text-[var(--accent)] hover:underline">
                    Administrar →
                  </Link>
                </div>
                {event.sessions.length === 0 ? (
                  <p className="text-sm text-[var(--ink-muted)]">Todavía no hay {noun.many}.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {event.sessions.map((s) => (
                      <li key={s.id}>
                        <Link href={sessionHref(s.id)} className="flex flex-wrap justify-between gap-2 rounded-md border border-[var(--border)] px-4 py-2.5 hover:border-[var(--accent)]">
                          <span>
                            <span className="font-mono">{formatDateTime(s.startsAt, s.venue.timezone)}</span>
                            <span className="text-[var(--ink-muted)]"> · {s.venue.name}</span>
                          </span>
                          <span className={s.ticketTypes.length ? "text-[var(--success)]" : "text-[var(--warn)]"}>
                            {s.ticketTypes.length ? `${s._count.tickets} / ${sellableCapacity(s.ticketTypes)}` : guestList ? "sin invitados" : "sin precios"}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {tab === "ventas" && report && (
            <>
              {!staff.readOnly && event.sessions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <Link href={`/eventos/${event.id}/importar`} className="btn text-xs">
                    Importar entradas desde Excel
                  </Link>
                  <Link href={`/eventos/${event.id}/reporte`} className="btn text-xs">
                    Reporte para imprimir
                  </Link>
                </div>
              )}
              <EventReport report={report} csvHref={`/eventos/${event.id}/reporte/csv`} />
            </>
          )}

          {tab === "funciones" && (
          <>
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
                        <span className={s.ticketTypes.length ? "text-[var(--success)]" : "text-[var(--warn)]"}>
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
          </>
          )}

          {tab === "configuracion" && (
          <>
          {clientMode && (
            <section className="card p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="eyebrow">Espacio del cliente</h2>
                {event.client &&
                  (accessOpen ? (
                    <span className="badge bg-[var(--success-soft)] text-[var(--success)]">
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
          </>
          )}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6">
          <section className="card p-5">
            <h2 className="eyebrow mb-1">Publicación</h2>
            <p className="mb-3 text-xs text-[var(--ink-muted)]">
              {doneCount} de {checks.length} listos
            </p>
            <div className="mb-4">
              <EventChecklist checks={checks} readOnly={staff.readOnly} />
            </div>
            {event.status === "PENDING_REVIEW" ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-[var(--ink-muted)]">
                  {needsReview
                    ? "Enviado a iPass. Sale en la web cuando lo aprueben; si piden cambios, los verás aquí."
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
                      ? "iPass lo revisa y lo publica en la web."
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
