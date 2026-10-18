import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime, formatMoney, sessionNoun, suggestedPresaleEnd, suggestedTimes, utcToZonedInput } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { BuyerPreview } from "@/components/buyer-preview";
import { EventChecklist } from "@/components/event-checklist";
import { SessionTimesFields } from "@/components/session-times-fields";
import { TicketTypeForm } from "@/components/ticket-type-form";
import { WizardSteps, type WizardStep } from "@/components/wizard-steps";
import { createSessionAction, publishEventAction } from "@/lib/actions/events";
import { eventChecks } from "@/lib/event-checklist";
import { EVENT_STATUS } from "@/lib/labels";
import { buyerPreviewUrl } from "@/lib/preview";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Armar el evento" };

const STEPS = ["lugar", "entradas", "revisar", "publicar"] as const;

type Props = { params: Promise<{ id: string; paso: string }> };

/**
 * Asistente para armar un evento en 5 pasos: Datos (al crearlo), Lugar y fecha, Entradas, Revisar (con la vista previa
 * del comprador) y Publicar. Usa las mismas acciones que la página del evento; se puede salir en cualquier paso.
 */
export default async function WizardPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id, paso } = await params;
  if (!(STEPS as readonly string[]).includes(paso)) notFound();
  const step = paso as WizardStep;
  if (staff.readOnly) redirect(`/eventos/${id}`);

  const event = await prisma.event.findFirst({
    where: { id, organizationId: staff.organization.id },
    include: {
      sessions: {
        where: { cancelledAt: null },
        orderBy: { startsAt: "asc" },
        include: {
          venue: { include: { sections: { orderBy: { sortOrder: "asc" }, include: { seats: { select: { id: true } } } } } },
          ticketTypes: { orderBy: { sortOrder: "asc" }, include: { section: { select: { name: true } } } },
        },
      },
    },
  });
  if (!event) notFound();
  const venues = await prisma.venue.findMany({
    where: { organizationId: staff.organization.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, timezone: true },
  });
  const noun = sessionNoun(event.category);
  const guestList = event.mode === "GUEST_LIST";
  const nightlife = event.category === "BOLICHE";
  const checks = eventChecks(event, venues.length);
  const ready = event.sessions.length > 0 && event.sessions.every((s) => s.ticketTypes.length > 0);
  const now = new Date();
  const next = (to: WizardStep, label: string, enabled = true) =>
    enabled ? (
      <Link href={`/eventos/${event.id}/asistente/${to}`} className="btn btn-primary">
        {label} →
      </Link>
    ) : (
      <span className="btn btn-primary cursor-not-allowed opacity-50" aria-disabled>
        {label} →
      </span>
    );

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={`/eventos/${event.id}`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ← Salir del asistente (ir al evento)
          </Link>
          <span className={`badge ${EVENT_STATUS[event.status].className}`}>{EVENT_STATUS[event.status].text}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1>
        <WizardSteps eventId={event.id} current={step} />
      </div>

      {step === "lugar" && (
        <section className="card space-y-5 p-6">
          <div>
            <h2 className="text-lg font-semibold">¿Dónde y cuándo?</h2>
            <p className="text-sm text-[var(--ink-muted)]">
              Elige un recinto que ya tengas o escribe un lugar nuevo (queda como una zona general con su aforo; si después
              quieres butacas o mesas, dibújalo en Recintos).
            </p>
          </div>
          {event.sessions.length > 0 && (
            <ul className="space-y-2">
              {event.sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-[var(--border)] px-4 py-3 text-sm">
                  <span>
                    <span className="font-mono">{formatDateTime(s.startsAt, s.venue.timezone)}</span> · {s.venue.name}
                  </span>
                  <span className="text-[var(--ink-muted)]">{s.ticketTypes.length ? `${s.ticketTypes.length} precio(s)` : "sin precios"}</span>
                </li>
              ))}
            </ul>
          )}
          <details open={event.sessions.length === 0} className="group">
            <summary className="cursor-pointer text-sm font-medium text-[var(--accent)]">
              {event.sessions.length === 0 ? `Agregar ${noun.a}` : `Agregar otra ${noun.one}`}
            </summary>
            <ActionForm action={createSessionAction} className="mt-4 flex flex-col gap-5">
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="next" value="asistente" />
              <SessionTimesFields category={event.category} venues={venues} newVenueOption defaults={suggestedTimes(event.category)} />
              <fieldset className="grid gap-3 rounded-md border border-dashed border-[var(--border)] p-4 sm:grid-cols-2">
                <legend className="px-1 text-sm font-medium">Lugar nuevo (si no lo elegiste arriba)</legend>
                <label className="label">
                  Nombre del lugar
                  <input name="newVenueName" maxLength={120} placeholder="ej. Salón Los Tajibos" className="field" />
                </label>
                <label className="label">
                  Aforo (personas)
                  <input name="newVenueCapacity" type="number" min={1} max={200000} placeholder="ej. 300" className="field" />
                </label>
                <label className="label">
                  Dirección (opcional)
                  <input name="newVenueAddress" maxLength={200} placeholder="ej. Av. San Martín 455" className="field" />
                </label>
                <label className="label">
                  Ciudad (opcional)
                  <input name="newVenueCity" maxLength={80} placeholder="ej. Santa Cruz" className="field" />
                </label>
              </fieldset>
              <button type="submit" className="btn btn-dark w-fit">
                Guardar y seguir
              </button>
            </ActionForm>
          </details>
          <div className="flex justify-end border-t border-[var(--border)] pt-4">{next("entradas", "Siguiente: entradas", event.sessions.length > 0)}</div>
        </section>
      )}

      {step === "entradas" && (
        <>
          {event.sessions.length === 0 ? (
            <p className="card p-6 text-sm">
              Primero agrega {noun.a}.{" "}
              <Link href={`/eventos/${event.id}/asistente/lugar`} className="text-[var(--accent)] underline">
                Volver al paso anterior
              </Link>
            </p>
          ) : guestList ? (
            <section className="card space-y-3 p-6">
              <h2 className="text-lg font-semibold">Invitados</h2>
              <p className="text-sm text-[var(--ink-muted)]">Este evento es con lista de invitados: cárgalos en cada {noun.one}.</p>
              <ul className="space-y-2 text-sm">
                {event.sessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/eventos/${event.id}/funciones/${s.id}/invitados`} className="text-[var(--accent)] hover:underline">
                      {formatDateTime(s.startsAt, s.venue.timezone)} · {s.venue.name} →
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            event.sessions.map((s) => {
              const priced = new Set(s.ticketTypes.map((t) => t.sectionId));
              const options = [...s.venue.sections.filter((x) => !priced.has(x.id)), ...s.venue.sections.filter((x) => priced.has(x.id))];
              return (
                <section key={s.id} className="card space-y-4 p-6">
                  <div>
                    <h2 className="text-lg font-semibold">
                      Entradas · <span className="font-mono text-base">{formatDateTime(s.startsAt, s.venue.timezone)}</span>
                    </h2>
                    <p className="text-sm text-[var(--ink-muted)]">{s.venue.name}</p>
                  </div>
                  {s.ticketTypes.length > 0 && (
                    <ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)] text-sm">
                      {s.ticketTypes.map((t) => (
                        <li key={t.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                          <span>
                            <strong>{t.name}</strong> · {t.section?.name}
                            {t.presale && <span className="badge ml-2 bg-[var(--warn-soft)] text-[var(--warn)]">preventa</span>}
                            {t.kind === "TABLE" && <span className="badge ml-2 bg-[#f3e8ff] text-[#7c3aed]">mesa de {t.peoplePerUnit}</span>}
                          </span>
                          <span className="font-mono">
                            {formatMoney(t.unitAmount, t.currency)} · {t.capacity} lugares
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.venue.sections.length === 0 ? (
                    <p className="text-sm">
                      El recinto no tiene secciones.{" "}
                      <Link href={`/recintos/${s.venueId}`} className="text-[var(--accent)] underline">
                        Configúralo
                      </Link>
                    </p>
                  ) : (
                    <TicketTypeForm
                      sessionId={s.id}
                      sectionOptions={options}
                      pricedSections={priced}
                      nightlife={nightlife}
                      ticketing={event.mode === "TICKETING"}
                      presaleEnd={suggestedPresaleEnd(utcToZonedInput(s.startsAt, s.venue.timezone).slice(0, 10), now, s.startsAt)}
                    />
                  )}
                </section>
              );
            })
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={`/eventos/${event.id}/asistente/lugar`} className="btn">
              ← Lugar y fecha
            </Link>
            {next("revisar", "Siguiente: revisar", ready)}
          </div>
        </>
      )}

      {step === "revisar" && (
        <>
          <section className="card space-y-4 p-6">
            <h2 className="text-lg font-semibold">Revisa antes de publicar</h2>
            <EventChecklist checks={checks} readOnly={false} />
          </section>
          {!guestList && (
            <section className="card space-y-3 p-6">
              <div>
                <h2 className="text-lg font-semibold">Así lo verá el comprador</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  La misma página de la web, aunque todavía no esté publicada. El enlace vence en una semana y no deja comprar.
                </p>
              </div>
              <BuyerPreview url={await buyerPreviewUrl(event.id)} />
            </section>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={`/eventos/${event.id}/asistente/entradas`} className="btn">
              ← Entradas
            </Link>
            {next("publicar", "Siguiente: publicar", ready)}
          </div>
        </>
      )}

      {step === "publicar" && (
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-semibold">Publicar</h2>
          {event.status === "PUBLISHED" ? (
            <p className="text-sm">
              {guestList ? "El evento está activo." : "¡Listo! El evento está a la venta en la web."}{" "}
              <Link href={`/eventos/${event.id}`} className="text-[var(--accent)] underline">
                Ir al evento
              </Link>
            </p>
          ) : event.status === "PENDING_REVIEW" ? (
            <p className="text-sm">
              Enviado a Impacta: sale en la web cuando lo aprueben.{" "}
              <Link href={`/eventos/${event.id}`} className="text-[var(--accent)] underline">
                Ir al evento
              </Link>
            </p>
          ) : (
            <ActionForm action={publishEventAction} className="flex flex-col gap-3">
              <input type="hidden" name="eventId" value={event.id} />
              <p className="text-sm text-[var(--ink-muted)]">
                {!ready
                  ? "Falta lo obligatorio (precios en cada función). Vuelve a los pasos anteriores."
                  : staff.platform
                    ? guestList
                      ? "Al activarlo se puede entrar con invitación (no aparece en la web)."
                      : "Al publicarlo sale a la venta en la web."
                    : "Se envía a Impacta, que lo revisa y lo publica."}
              </p>
              <button type="submit" disabled={!ready} className="btn btn-primary w-fit disabled:cursor-not-allowed disabled:opacity-50">
                {!staff.platform ? "Enviar a revisión" : guestList ? "Activar evento" : "Publicar evento"}
              </button>
            </ActionForm>
          )}
          <div className="flex justify-start border-t border-[var(--border)] pt-4">
            <Link href={`/eventos/${event.id}/asistente/revisar`} className="btn">
              ← Revisar
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
