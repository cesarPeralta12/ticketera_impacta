import type { Metadata } from "next";
import { connection } from "next/server";
import { CATEGORY_LABEL, DEFAULT_TIMEZONE, formatDateTime, formatMoney } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { approveEventAction, enterOrganizationAction, rejectEventAction } from "@/lib/actions/platform";
import { MODE_LABEL } from "@/lib/labels";
import { requirePlatform } from "@/lib/session";

export const metadata: Metadata = { title: "Aprobaciones" };

export default async function ApprovalsPage() {
  await connection();
  await requirePlatform();
  const events = await prisma.event.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: { submittedAt: "asc" },
    include: {
      organization: { select: { id: true, name: true } },
      sessions: {
        where: { cancelledAt: null },
        orderBy: { startsAt: "asc" },
        include: {
          venue: { select: { name: true, city: true, timezone: true } },
          ticketTypes: { orderBy: { sortOrder: "asc" }, include: { section: { select: { name: true } } } },
        },
      },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{events.length} esperando</p>
        <h1 className="text-2xl font-semibold tracking-tight">Aprobaciones</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Eventos que los organizadores enviaron. Al aprobarlos salen en la web y quedan a la venta. Si algo no está
          bien, devuélvelo con lo que hay que corregir: el organizador lo ve en su evento y lo vuelve a enviar.
        </p>
      </div>

      {events.length === 0 && (
        <p className="card p-6 text-sm text-[var(--ink-muted)]">No hay eventos esperando aprobación.</p>
      )}

      {events.map((event) => (
        <article key={event.id} className="card overflow-hidden">
          <div className="flex flex-wrap gap-5 p-5">
            {event.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- imagen externa cargada por el organizador
              <img src={event.imageUrl} alt="" className="h-28 w-44 rounded-md object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{event.organization.name}</p>
              <h2 className="text-lg font-semibold">{event.title}</h2>
              <p className="text-xs text-[var(--ink-dim)]">
                {CATEGORY_LABEL[event.category]} · {MODE_LABEL[event.mode]} · enviado el{" "}
                {event.submittedAt ? formatDateTime(event.submittedAt, DEFAULT_TIMEZONE) : "—"}
              </p>
              {event.description && (
                <p className="mt-2 line-clamp-3 text-sm text-[var(--ink-muted)]">{event.description}</p>
              )}
            </div>
          </div>

          <div className="border-t border-[var(--border)] px-5 py-3">
            {event.sessions.map((s) => (
              <div key={s.id} className="py-2 text-sm">
                <p className="font-medium">
                  {formatDateTime(s.startsAt, s.venue.timezone)} · {s.venue.name}
                  {s.venue.city ? ` (${s.venue.city})` : ""}
                </p>
                <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--ink-muted)]">
                  {s.ticketTypes.map((t) => (
                    <li key={t.id}>
                      {t.name}
                      {t.section ? ` · ${t.section.name}` : ""}: <span className="font-mono">{formatMoney(t.unitAmount, t.currency)}</span>{" "}
                      × {t.capacity}
                      {t.presale && " · preventa"}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-start gap-3 border-t border-[var(--border)] bg-[var(--surface-2)]/40 px-5 py-4">
            <ActionForm action={approveEventAction} confirm={`¿Aprobar "${event.title}"? Sale en la web y queda a la venta.`}>
              <input type="hidden" name="eventId" value={event.id} />
              <button type="submit" className="btn btn-primary">
                Aprobar y publicar
              </button>
            </ActionForm>
            <form action={enterOrganizationAction}>
              <input type="hidden" name="organizationId" value={event.organization.id} />
              <input type="hidden" name="next" value={`/eventos/${event.id}`} />
              <button type="submit" className="btn">
                Ver el evento completo
              </button>
            </form>
            <ActionForm action={rejectEventAction} className="flex min-w-72 flex-1 flex-wrap items-start gap-2">
              <input type="hidden" name="eventId" value={event.id} />
              <textarea
                name="note"
                rows={1}
                required
                placeholder="Qué hay que corregir (ej. la imagen no corresponde)"
                className="field min-w-56 flex-1"
              />
              <button type="submit" className="btn text-[var(--danger)]">
                Devolver
              </button>
            </ActionForm>
          </div>
        </article>
      ))}
    </div>
  );
}
