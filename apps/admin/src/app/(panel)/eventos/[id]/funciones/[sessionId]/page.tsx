import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime, formatMoney } from "@ticketera/core";
import { getSessionAvailability, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { SeatMapPreview, positioned } from "@/components/seat-map-preview";
import {
  addTicketTypeAction,
  deleteSessionAction,
  deleteTicketTypeAction,
  updateQueueSettingsAction,
} from "@/lib/actions/events";
import { SEATING_LABEL } from "@/lib/labels";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Función" };

type Props = { params: Promise<{ id: string; sessionId: string }> };

export default async function SessionPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id, sessionId } = await params;

  const session = await prisma.eventSession.findFirst({
    where: { id: sessionId, eventId: id, event: { organizationId: staff.organization.id } },
    include: {
      event: true,
      venue: { include: { sections: { orderBy: { sortOrder: "asc" }, include: { seats: { select: { x: true, y: true } } } } } },
      ticketTypes: { orderBy: { sortOrder: "asc" }, include: { section: true, _count: { select: { orderItems: true } } } },
    },
  });
  if (!session) notFound();

  const [remaining, guests] = await Promise.all([
    getSessionAvailability(session.id),
    prisma.ticket.count({ where: { sessionId: session.id, order: { channel: "GUEST" }, status: { in: ["VALID", "USED"] } } }),
  ]);
  const guestList = session.event.mode === "GUEST_LIST";
  const pricedSections = new Set(session.ticketTypes.map((t) => t.sectionId));
  const seatedSections = session.venue.sections.filter((s) => s.seatingMode === "RESERVED");
  // Secciones del recinto que no se venden en esta función: no aparecen en el sitio.
  const unpriced = session.venue.sections.filter((s) => !pricedSections.has(s.id));
  // En el selector, primero las que faltan por cargar.
  const sectionOptions = [...unpriced, ...session.venue.sections.filter((s) => pricedSections.has(s.id))];
  const tz = session.venue.timezone;

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/eventos/${id}`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← {session.event.title}
        </Link>
        <h1 className="mt-1 font-mono text-2xl font-medium tracking-tight">{formatDateTime(session.startsAt, tz)}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {session.venue.name} · hora de {tz}
          {session.doorsOpenAt && ` · puertas ${formatDateTime(session.doorsOpenAt, tz)}`}
        </p>
      </div>

      <Link
        href={`/eventos/${id}/funciones/${session.id}/invitados`}
        className={`card flex flex-wrap items-center justify-between gap-3 p-5 transition-colors hover:border-[var(--accent)] ${guestList ? "border-[var(--accent)]" : ""}`}
      >
        <span>
          <span className="block font-medium">{guestList ? "Lista de invitados" : "Invitaciones / cortesías"}</span>
          <span className="text-sm text-[var(--ink-muted)]">
            {guestList
              ? "Este evento no tiene venta: carga aquí a los invitados (Excel, CSV o a mano) y cada uno recibe su QR."
              : "Entradas sin cobro con QR propio; ocupan el cupo del tipo de entrada elegido."}
          </span>
        </span>
        <span className="font-mono text-sm text-[var(--accent)]">{guests} invitado(s) →</span>
      </Link>

      <section className="card p-6">
        <h2 className="eyebrow mb-4">Tipos de entrada</h2>
        {session.ticketTypes.length === 0 ? (
          <p className="mb-4 text-sm text-[var(--ink-muted)]">Agrega al menos un tipo de entrada para esta función.</p>
        ) : (
          <div className="mb-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="eyebrow border-b border-[var(--border)]">
                <tr>
                  <th className="py-2 pr-4 font-normal">Entrada</th>
                  <th className="py-2 pr-4 font-normal">Sección</th>
                  <th className="py-2 pr-4 text-right font-normal">Precio</th>
                  <th className="py-2 pr-4 text-right font-normal">Quedan</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {session.ticketTypes.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2.5 pr-4 font-medium">{t.name}</td>
                    <td className="py-2.5 pr-4 text-[var(--ink-muted)]">
                      {t.section ? `${t.section.name} · ${SEATING_LABEL[t.section.seatingMode]}` : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono">{formatMoney(t.unitAmount, t.currency)}</td>
                    <td className="py-2.5 pr-4 text-right font-mono">
                      {remaining.get(t.id) ?? 0} / {t.capacity}
                    </td>
                    <td className="py-2.5 text-right">
                      {t._count.orderItems === 0 && (
                        <ActionForm action={deleteTicketTypeAction} confirm={`¿Borrar "${t.name}"?`}>
                          <input type="hidden" name="ticketTypeId" value={t.id} />
                          <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                            Borrar
                          </button>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {unpriced.length > 0 && session.venue.sections.length > 0 && (
          <div className="mb-4 rounded-md bg-[var(--warn-soft)] px-3 py-2.5 text-sm text-[var(--warn)]">
            <p className="font-medium">
              {unpriced.length === 1 ? "1 sección no se vende" : `${unpriced.length} secciones no se venden`} en esta
              función y no aparecen en el sitio:
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {unpriced.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
            </p>
            <p className="mt-1 text-xs">Para venderlas, agrégales un precio aquí abajo (una por vez).</p>
          </div>
        )}

        {session.venue.sections.length === 0 ? (
          <p className="text-sm">
            El recinto no tiene secciones.{" "}
            <Link href={`/recintos/${session.venueId}`} className="text-[var(--accent)] underline">
              Configúralo
            </Link>
            .
          </p>
        ) : (
          <ActionForm action={addTicketTypeAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="sessionId" value={session.id} />
            <label className="label">
              Sección
              <select name="sectionId" required className="field">
                {sectionOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.seatingMode === "RESERVED" ? `${s.seats.length} butacas` : `aforo ${s.capacity}`}
                    {pricedSections.has(s.id) ? " (ya tiene precio)" : " (sin precio)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Nombre
              <input name="name" required placeholder="General, VIP, Preventa…" className="field" />
            </label>
            <label className="label">
              Precio (Bs)
              <input name="price" required inputMode="decimal" placeholder="120" className="field w-28" />
            </label>
            <label className="label">
              Cupo
              <input name="capacity" type="number" min={1} placeholder="solo general" className="field w-28" />
            </label>
            <label className="label">
              Máx. por compra
              <input name="maxPerOrder" type="number" min={1} max={10} defaultValue={10} className="field w-24" />
            </label>
            <button type="submit" className="btn btn-dark">
              Agregar
            </button>
          </ActionForm>
        )}
        <p className="mt-3 text-xs text-[var(--ink-dim)]">
          En secciones numeradas el cupo es la cantidad de butacas. Varios tipos pueden compartir una sección general
          (ej. Preventa y General): juntos nunca superan su aforo.
        </p>
      </section>

      {seatedSections.length > 0 && (
        <section className="card space-y-3 p-6">
          <div className="flex items-center justify-between">
            <h2 className="eyebrow">Mapa del recinto</h2>
            <Link href={`/recintos/${session.venueId}`} className="text-sm text-[var(--accent)] hover:underline">
              Editar mapa
            </Link>
          </div>
          <SeatMapPreview
            sections={seatedSections.map((s) => ({ ...s, seats: positioned(s.seats), muted: !pricedSections.has(s.id) }))}
          />
          <p className="text-xs text-[var(--ink-dim)]">Las secciones atenuadas no tienen precio en esta función.</p>
        </section>
      )}

      {!guestList && (
        <section className="card p-6">
          <h2 className="eyebrow mb-4">Cola virtual</h2>
          <ActionForm action={updateQueueSettingsAction} successMessage="Configuración guardada." className="flex flex-col gap-3">
            <input type="hidden" name="sessionId" value={session.id} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="queueEnabled" defaultChecked={session.queueEnabled} className="accent-[var(--accent)]" />
              Activar sala de espera para esta función
            </label>
            <label className="label">
              Compradores comprando a la vez
              <input
                name="maxConcurrentCheckouts"
                type="number"
                min={1}
                defaultValue={session.maxConcurrentCheckouts ?? undefined}
                placeholder="ej. 50"
                className="field w-40"
              />
            </label>
            <p className="text-xs text-[var(--ink-dim)]">
              Para ventas de alta demanda: los compradores esperan en una fila y entran a comprar por turnos de 10 minutos.
            </p>
            <button type="submit" className="btn w-fit">
              Guardar
            </button>
          </ActionForm>
        </section>
      )}

      <ActionForm action={deleteSessionAction} confirm="¿Borrar esta función? No se puede deshacer.">
        <input type="hidden" name="sessionId" value={session.id} />
        <button type="submit" className="text-sm text-[var(--danger)] hover:underline">
          Borrar función
        </button>
      </ActionForm>
    </div>
  );
}
