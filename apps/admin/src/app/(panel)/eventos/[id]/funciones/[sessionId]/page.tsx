import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { currentPrice, formatDateTime, formatMoney, saleState, utcToZonedInput, type SaleState } from "@ticketera/core";
import { getSessionAvailability, prisma } from "@ticketera/db";
import { AccessMethodsField } from "@/components/access-methods-field";
import { ActionForm } from "@/components/action-form";
import { SeatMapPreview, positioned } from "@/components/seat-map-preview";
import {
  addTicketTypeAction,
  updateTicketTypeSalesAction,
  deleteSessionAction,
  deleteTicketTypeAction,
  updateAccessMethodsAction,
  updateQueueSettingsAction,
} from "@/lib/actions/events";
import { SEATING_LABEL } from "@/lib/labels";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Función" };

const SALE_STATE: Record<SaleState, { text: string; className: string }> = {
  open: { text: "A la venta", className: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  scheduled: { text: "Programada", className: "bg-[#e8eefc] text-[#3b5bb5]" },
  closed: { text: "Terminada", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
};

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
  const now = new Date();

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
        href={`/eventos/${id}/funciones/${session.id}/en-vivo`}
        className="card flex flex-wrap items-center justify-between gap-3 border-[var(--accent)] p-5 transition-colors hover:bg-[var(--accent-soft)]"
      >
        <span>
          <span className="block font-medium">Ingreso en vivo</span>
          <span className="text-sm text-[var(--ink-muted)]">
            Mapa del recinto y lista de entradas: se van pintando de verde las que ingresan, con hora, puerta y rechazos.
          </span>
        </span>
        <span className="font-mono text-sm text-[var(--accent)]">Abrir →</span>
      </Link>

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
                  <th className="py-2 pr-4 font-normal">Lectura en puerta</th>
                  <th className="py-2 pr-4 font-normal">Venta</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {session.ticketTypes.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2.5 pr-4 font-medium">
                      {t.name}
                      {t.presale && <span className="badge ml-2 bg-[var(--warn-soft)] text-[var(--warn)]">preventa</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--ink-muted)]">
                      {t.section ? `${t.section.name} · ${SEATING_LABEL[t.section.seatingMode]}` : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono">
                      {formatMoney(currentPrice(t, now).unitAmount, t.currency)}
                      {currentPrice(t, now).discountPercent ? (
                        <span className="block text-xs text-[var(--warn)]">
                          -{t.discountPercent}% (lista {formatMoney(t.unitAmount, t.currency)})
                        </span>
                      ) : t.discountPercent ? (
                        <span className="block text-xs text-[var(--ink-dim)]">
                          {t.discountEndsAt && t.discountEndsAt <= now ? "descuento terminado" : `-${t.discountPercent}% programado`}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono">
                      {remaining.get(t.id) ?? 0} / {t.capacity}
                    </td>
                    <td className="py-2.5 pr-4">
                      <ActionForm action={updateAccessMethodsAction} successMessage="Guardado." className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="ticketTypeId" value={t.id} />
                        <AccessMethodsField defaultValue={t.accessMethods} />
                        <button type="submit" className="btn px-2 py-1 text-xs">
                          Guardar
                        </button>
                      </ActionForm>
                    </td>
                    <td className="py-2.5 pr-4 text-xs">
                      <span className={`badge ${SALE_STATE[saleState(t)].className}`}>{SALE_STATE[saleState(t)].text}</span>
                      <span className="mt-1 block text-[var(--ink-muted)]">
                        {t.salesStartAt || t.salesEndAt
                          ? [
                              t.salesStartAt && `desde ${formatDateTime(t.salesStartAt, tz)}`,
                              t.salesEndAt && `hasta ${formatDateTime(t.salesEndAt, tz)}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : "Sin fechas: siempre"}
                      </span>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[var(--accent)]">Editar fechas</summary>
                        <ActionForm
                          action={updateTicketTypeSalesAction}
                          successMessage="Fechas guardadas."
                          className="mt-2 flex flex-col gap-2"
                        >
                          <input type="hidden" name="ticketTypeId" value={t.id} />
                          <label className="flex items-center gap-2">
                            <input type="checkbox" name="presale" defaultChecked={t.presale} /> Es preventa
                          </label>
                          <label className="label">
                            Desde
                            <input
                              type="datetime-local"
                              name="salesStartAt"
                              defaultValue={t.salesStartAt ? utcToZonedInput(t.salesStartAt, tz) : ""}
                              className="field"
                            />
                          </label>
                          <label className="label">
                            Hasta
                            <input
                              type="datetime-local"
                              name="salesEndAt"
                              defaultValue={t.salesEndAt ? utcToZonedInput(t.salesEndAt, tz) : ""}
                              className="field"
                            />
                          </label>
                          <label className="label">
                            Descuento de preventa (%)
                            <input
                              name="discountPercent"
                              inputMode="numeric"
                              defaultValue={t.discountPercent ?? ""}
                              placeholder="sin descuento"
                              className="field w-32"
                            />
                          </label>
                          <label className="label">
                            Descuento desde
                            <input
                              type="datetime-local"
                              name="discountStartsAt"
                              defaultValue={t.discountStartsAt ? utcToZonedInput(t.discountStartsAt, tz) : ""}
                              className="field"
                            />
                          </label>
                          <label className="label">
                            Descuento hasta
                            <input
                              type="datetime-local"
                              name="discountEndsAt"
                              defaultValue={t.discountEndsAt ? utcToZonedInput(t.discountEndsAt, tz) : ""}
                              className="field"
                            />
                          </label>
                          <button type="submit" className="btn w-fit text-xs">
                            Guardar
                          </button>
                        </ActionForm>
                      </details>
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
            <div className="label">
              Lectura en puerta
              <div className="flex h-[38px] items-center">
                <AccessMethodsField />
              </div>
            </div>
            <div className="flex basis-full flex-wrap items-end gap-3 rounded-md border border-dashed border-[var(--border)] p-3">
              <label className="flex items-center gap-2 self-center text-sm">
                <input type="checkbox" name="presale" className="h-4 w-4" /> Es preventa
              </label>
              <label className="label">
                Venta desde (opcional)
                <input type="datetime-local" name="salesStartAt" className="field" />
              </label>
              <label className="label">
                Venta hasta {"(obligatorio en preventa)"}
                <input type="datetime-local" name="salesEndAt" className="field" />
              </label>
              <label className="flex items-center gap-2 self-center text-sm">
                <input type="checkbox" name="exclusive" defaultChecked className="h-4 w-4" /> Mientras dure la preventa, no
                vender las otras entradas de esta sección
              </label>
              <p className="basis-full text-xs text-[var(--ink-dim)]">
                Hora del recinto. Ejemplo: &ldquo;Preventa&rdquo; a Bs 70 hasta el 20/10 a las 23:59: ese momento la
                &ldquo;General&rdquo; de la misma sección empieza sola. En butacas numeradas siempre es así (un precio por
                butaca a la vez).
              </p>
            </div>
            <div className="flex basis-full flex-wrap items-end gap-3 rounded-md border border-dashed border-[var(--border)] p-3">
              <p className="basis-full text-sm font-medium">Descuento de preventa (opcional)</p>
              <label className="label">
                Porcentaje (%)
                <input name="discountPercent" inputMode="numeric" placeholder="ej. 20" className="field w-28" />
              </label>
              <label className="label">
                Desde (opcional)
                <input type="datetime-local" name="discountStartsAt" className="field" />
              </label>
              <label className="label">
                Hasta
                <input type="datetime-local" name="discountEndsAt" className="field" />
              </label>
              <p className="basis-full text-xs text-[var(--ink-dim)]">
                Misma entrada, mismo cupo: hasta la fecha se cobra el precio con ese porcentaje menos y después vuelve al
                precio normal solo. La web muestra el precio normal tachado y el descuento.
              </p>
            </div>
            <button type="submit" className="btn btn-dark">
              Agregar
            </button>
          </ActionForm>
        )}
        <p className="mt-3 text-xs text-[var(--ink-dim)]">
          <strong>Lectura en puerta</strong>: la app del portero solo ofrece los métodos que admitan las entradas de su
          función (por ejemplo, solo QR, o código de barras y NFC). Una entrada leída con un método no admitido se rechaza.
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
