import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  currentPrice,
  effectiveSaleWindow,
  formatClock,
  formatDateTime,
  formatMoney,
  inheritsSaleWindow,
  isSeatedTablesLayout,
  isTablesLayout,
  suggestedPresaleEnd,
  isZoneLayout,
  mapItemsOf,
  parseProgram,
  saleState,
  sessionNoun,
  sessionTimesInput,
  timeZoneLabel,
  utcToZonedInput,
  type SaleState,
  type ZoneShape,
} from "@ticketera/core";
import { getSessionAvailability, getZoneAvailability, prisma } from "@ticketera/db";
import { AccessMethodsField } from "@/components/access-methods-field";
import { TicketTypeForm } from "@/components/ticket-type-form";
import { ActionForm } from "@/components/action-form";
import { SeatMapPreview, positioned } from "@/components/seat-map-preview";
import {
  updateTicketTypeSalesAction,
  deleteSessionAction,
  deleteTicketTypeAction,
  duplicateSessionAction,
  setQrModeAction,
  updateEntryRulesAction,
  updateAccessMethodsAction,
  updateProgramAction,
  updateQueueSettingsAction,
  updateSessionAction,
} from "@/lib/actions/events";
import { ProgramEditor } from "@/components/program-editor";
import { PrintedCard } from "./printed-card";
import { SessionTimesFields } from "@/components/session-times-fields";
import { seatingLabel } from "@/lib/labels";
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
      venue: {
        include: {
          sections: { orderBy: { sortOrder: "asc" }, include: { seats: { select: { x: true, y: true, number: true } } } },
          zones: { orderBy: [{ level: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true } },
          accessPoints: { where: { direction: { not: "IN" } }, select: { id: true } },
        },
      },
      ticketTypes: {
        orderBy: { sortOrder: "asc" },
        include: { section: true, zones: { select: { id: true } }, _count: { select: { orderItems: true } } },
      },
    },
  });
  if (!session) notFound();

  const [remaining, zones, guests, issued, held] = await Promise.all([
    getSessionAvailability(session.id),
    getZoneAvailability(session.id),
    prisma.ticket.count({ where: { sessionId: session.id, order: { channel: "GUEST" }, status: { in: ["VALID", "USED"] } } }),
    prisma.ticket.count({ where: { sessionId: session.id, status: { in: ["VALID", "USED"] } } }),
    prisma.seatHoldSeat.count({ where: { sessionId: session.id } }),
  ]);
  const guestList = session.event.mode === "GUEST_LIST";
  const pricedSections = new Set(session.ticketTypes.map((t) => t.sectionId));
  const seatedSections = session.venue.sections.filter((s) => s.seatingMode === "RESERVED");
  // Zonas generales dibujadas en el mapa del recinto (con lo que queda en esta función).
  const drawnZones = session.venue.sections.flatMap((s) =>
    s.seatingMode === "GENERAL_ADMISSION" && isZoneLayout(s.layout) ? [{ section: s, zone: s.layout as ZoneShape }] : [],
  );
  // Secciones del recinto que no se venden en esta función: no aparecen en el sitio.
  const unpriced = session.venue.sections.filter((s) => !pricedSections.has(s.id));
  // En el selector, primero las que faltan por cargar.
  const sectionOptions = [...unpriced, ...session.venue.sections.filter((s) => pricedSections.has(s.id))];
  const tz = session.venue.timezone;
  const now = new Date();
  const nightlife = session.event.category === "BOLICHE";
  const noun = sessionNoun(session.event.category);
  const hasConsumption = session.ticketTypes.some((t) => t.kind === "TABLE" || (t.consumptionAmount ?? 0) > 0);
  const nextWeek = utcToZonedInput(new Date(session.startsAt.getTime() + 7 * 86_400_000), tz).slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/eventos/${id}`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← {session.event.title}
        </Link>
        <p className="eyebrow mt-2">{noun.One}</p>
        <h1 className="font-mono text-2xl font-medium tracking-tight">{formatDateTime(session.startsAt, tz)}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {session.venue.name}
          {session.doorsOpenAt && ` · puertas ${formatClock(session.doorsOpenAt, tz)}`}
          {session.endsAt && ` · termina ${formatDateTime(session.endsAt, tz)}`} · {timeZoneLabel(tz)}
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

      {(session.ticketTypes.some((t) => t.kind === "TABLE") || seatedSections.some((s) => isTablesLayout(s.layout) || isSeatedTablesLayout(s.layout))) && (
        <Link
          href={`/boleteria/${session.id}/mesas`}
          className="card flex flex-wrap items-center justify-between gap-3 p-5 transition-colors hover:border-[var(--accent)]"
        >
          <span>
            <span className="block font-medium">Mesas (anfitriones)</span>
            <span className="text-sm text-[var(--ink-muted)]">Cada mesa en vivo: libre, vendida u ocupada, quién la compró, cuántos entraron y su consumo.</span>
          </span>
          <span className="font-mono text-sm text-[var(--accent)]">Abrir →</span>
        </Link>
      )}

      {nightlife && hasConsumption && (
        <Link
          href={`/barra/${session.id}`}
          className="card flex flex-wrap items-center justify-between gap-3 p-5 transition-colors hover:border-[var(--accent)]"
        >
          <span>
            <span className="block font-medium">Barra (consumos)</span>
            <span className="text-sm text-[var(--ink-muted)]">
              Saldo de consumo de cada mesa y de las entradas con trago: se lee el QR y se descuenta lo que piden.
            </span>
          </span>
          <span className="font-mono text-sm text-[var(--accent)]">Abrir →</span>
        </Link>
      )}

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

      {!guestList && seatedSections.length > 0 && (
        <Link
          href={`/eventos/${id}/funciones/${session.id}/retenciones`}
          className="card flex flex-wrap items-center justify-between gap-3 p-5 transition-colors hover:border-[var(--accent)]"
        >
          <span>
            <span className="block font-medium">Retenciones</span>
            <span className="text-sm text-[var(--ink-muted)]">
              Aparta butacas, mesas o sillas (prensa, artistas, producción) con un código para liberarlas.
            </span>
          </span>
          <span className="font-mono text-sm text-[var(--accent)]">{held} apartada(s) →</span>
        </Link>
      )}

      {!guestList && <PrintedCard session={session} organizationId={staff.organization.id} />}

      {zones.length > 0 && (
        <section className="card p-6">
          <h2 className="eyebrow mb-1">Zonas sin asientos (de pie)</h2>
          <p className="mb-4 text-sm text-[var(--ink-muted)]">Aforo de cada zona y cuántos lugares quedan, sumando todos sus tipos de entrada (preventa, general…).</p>
          <ul className="space-y-3">
            {zones.map((z) => {
              const pct = z.capacity === 0 ? 0 : Math.round((z.sold / z.capacity) * 100);
              return (
                <li key={z.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="h-3 w-3 rounded-full" style={{ background: z.color }} />
                      {z.name}
                    </span>
                    <span className="font-mono text-sm">
                      <strong>{z.remaining}</strong> restantes <span className="text-[var(--ink-dim)]">· {z.sold} de {z.capacity} ({pct}%)</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: z.remaining === 0 ? "var(--danger)" : z.color }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section id="horarios" className="card scroll-mt-6 p-6">
        <h2 className="eyebrow mb-4">Horarios y venta</h2>
        <ActionForm action={updateSessionAction} className="flex flex-col gap-4">
          <input type="hidden" name="sessionId" value={session.id} />
          <SessionTimesFields
            category={session.event.category}
            timeZone={tz}
            defaults={{
              ...sessionTimesInput(session, tz),
              open: session.salesStartAt ? "date" : "publish",
              openAt: session.salesStartAt ? utcToZonedInput(session.salesStartAt, tz) : undefined,
              close: session.salesEndAt ? "date" : "start",
              closeAt: session.salesEndAt ? utcToZonedInput(session.salesEndAt, tz) : undefined,
            }}
          />
          {issued > 0 && (
            <p className="text-xs text-[var(--warn)]">
              Ya hay {issued} entrada(s) emitida(s): si cambias el día o la hora, avisa a los compradores.
            </p>
          )}
          <button type="submit" className="btn btn-dark w-fit">
            Guardar horarios
          </button>
        </ActionForm>
      </section>

      <section className="card p-6">
        <h2 className="eyebrow mb-1">Programa</h2>
        <p className="mb-4 text-sm text-[var(--ink-muted)]">Quién toca y a qué hora (opcional). Se muestra en la web y en la entrada.</p>
        <ActionForm action={updateProgramAction} className="flex flex-col gap-3">
          <input type="hidden" name="sessionId" value={session.id} />
          <ProgramEditor initial={parseProgram(session.program)} />
          <button type="submit" className="btn w-fit">
            Guardar programa
          </button>
        </ActionForm>
      </section>

      <section className="card p-6">
        <h2 className="eyebrow mb-4">Precios (tipos de entrada)</h2>
        {session.ticketTypes.length === 0 ? (
          <p className="mb-4 text-sm text-[var(--ink-muted)]">
            Todavía no hay precios. Agrega el primero abajo: sección, nombre, precio y cupo.
          </p>
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
                      {t.qrMode === "DYNAMIC" && <span className="badge ml-2 bg-[#e8eefc] text-[#3b5bb5]">QR dinámico</span>}
                      {t.kind === "TABLE" && (
                        <span className="badge ml-2 bg-[#f3e8ff] text-[#7b2fbf]">mesa · {t.peoplePerUnit} personas</span>
                      )}
                      {(t.consumptionAmount ?? 0) > 0 && (
                        <span className="mt-1 block text-xs text-[var(--ink-muted)]">
                          Consumo incluido: {formatMoney(t.consumptionAmount!, t.currency)}
                          {t.kind === "TABLE" ? " por mesa" : ""}
                        </span>
                      )}
                      {t.entryUntil && (
                        <span className="mt-1 block text-xs text-[var(--warn)]">Válida para entrar hasta las {formatClock(t.entryUntil, tz)}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--ink-muted)]">
                      {t.section ? `${t.section.name} · ${seatingLabel(t.section)}` : "—"}
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
                      {t.kind === "TABLE" && <span className="block text-xs text-[var(--ink-dim)]">mesas</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      {t.qrMode === "DYNAMIC" ? (
                        <p className="text-xs text-[var(--ink-muted)]">
                          Solo QR, y cambia cada 30 segundos. El comprador lo abre en su celular; no se vende en boletería ni se imprime.
                        </p>
                      ) : (
                        <ActionForm action={updateAccessMethodsAction} successMessage="Guardado." className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="ticketTypeId" value={t.id} />
                          <AccessMethodsField defaultValue={t.accessMethods} />
                          <button type="submit" className="btn px-2 py-1 text-xs">
                            Guardar
                          </button>
                        </ActionForm>
                      )}
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-[var(--accent)]">
                          {t.maxEntries === 1 ? "Un ingreso" : t.maxEntries === 0 ? "Reingreso sin límite" : `Hasta ${t.maxEntries} ingresos`}
                          {t.zones.length > 0 && ` · ${t.zones.length} zona(s)`}
                        </summary>
                        <ActionForm action={updateEntryRulesAction} successMessage="Guardado." className="mt-2 flex flex-col gap-2">
                          <input type="hidden" name="ticketTypeId" value={t.id} />
                          <label className="label">
                            Ingresos permitidos
                            <select name="maxEntries" defaultValue={t.maxEntries} className="field w-auto text-xs">
                              <option value={1}>1 (sin reingreso)</option>
                              <option value={2}>2 (un reingreso)</option>
                              <option value={3}>3</option>
                              <option value={5}>5</option>
                              <option value={0}>Sin límite</option>
                            </select>
                          </label>
                          {session.venue.zones.length > 0 && (
                            <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
                              <legend className="mb-1 font-medium">Zonas que abre (ninguna = las de siempre)</legend>
                              {session.venue.zones.map((z) => (
                                <label key={z.id} className="flex items-center gap-1">
                                  <input type="checkbox" name="zoneIds" value={z.id} defaultChecked={t.zones.some((x) => x.id === z.id)} />
                                  <span className="h-2 w-2 rounded-full" style={{ background: z.color }} />
                                  {z.name}
                                </label>
                              ))}
                            </fieldset>
                          )}
                          <button type="submit" className="btn w-fit px-2 py-1 text-xs">
                            Guardar reglas
                          </button>
                          {session.venue.accessPoints.length === 0 && (
                            <p className="text-[var(--ink-dim)]">Para reingresar hace falta una puerta de salida (se configura en el recinto).</p>
                          )}
                        </ActionForm>
                      </details>
                      {t._count.orderItems === 0 && session.event.mode === "TICKETING" && (
                        <ActionForm action={setQrModeAction} successMessage="Guardado." className="mt-1">
                          <input type="hidden" name="ticketTypeId" value={t.id} />
                          <input type="hidden" name="mode" value={t.qrMode === "DYNAMIC" ? "STATIC" : "DYNAMIC"} />
                          <button type="submit" className="text-xs text-[var(--accent)] hover:underline">
                            {t.qrMode === "DYNAMIC" ? "Volver a QR fijo" : "Usar QR dinámico"}
                          </button>
                        </ActionForm>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-xs">
                      <span className={`badge ${SALE_STATE[saleState(effectiveSaleWindow(t, session))].className}`}>
                        {SALE_STATE[saleState(effectiveSaleWindow(t, session))].text}
                      </span>
                      <span className="mt-1 block text-[var(--ink-muted)]">
                        {inheritsSaleWindow(t)
                          ? "Igual que la función"
                          : [
                              t.salesStartAt && `desde ${formatDateTime(t.salesStartAt, tz)}`,
                              t.salesEndAt && `hasta ${formatDateTime(t.salesEndAt, tz)}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
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
          <TicketTypeForm
            sessionId={session.id}
            sectionOptions={sectionOptions}
            pricedSections={pricedSections}
            nightlife={nightlife}
            ticketing={session.event.mode === "TICKETING"}
            presaleEnd={suggestedPresaleEnd(utcToZonedInput(session.startsAt, tz).slice(0, 10), now, session.startsAt)}
          />
        )}
        <p className="mt-3 text-xs text-[var(--ink-dim)]">
          Varios precios pueden compartir una sección general (ej. Preventa y General): juntos nunca superan su aforo.
          <strong> Lectura en puerta</strong>: la app del portero solo acepta los métodos marcados (QR, código de barras,
          NFC).
        </p>
      </section>

      {(seatedSections.length > 0 || drawnZones.length > 0) && (
        <section className="card space-y-3 p-6">
          <div className="flex items-center justify-between">
            <h2 className="eyebrow">Mapa del recinto</h2>
            <Link href={`/recintos/${session.venueId}`} className="text-sm text-[var(--accent)] hover:underline">
              Editar mapa
            </Link>
          </div>
          <SeatMapPreview
            items={mapItemsOf(session.venue.mapItems)}
            sections={[
              ...drawnZones.map(({ section, zone }) => {
                const availability = zones.find((z) => z.id === section.id);
                return {
                  id: section.id,
                  name: section.name,
                  color: section.color,
                  seats: [],
                  zone,
                  detail: availability ? `Quedan ${availability.remaining} / ${availability.capacity}` : `Aforo ${section.capacity}`,
                  muted: !pricedSections.has(section.id),
                };
              }),
              ...seatedSections.map((s) =>
                isTablesLayout(s.layout)
                  ? {
                      ...s,
                      table: { radius: s.layout.radius, shape: s.layout.shape },
                      seats: s.seats.flatMap((seat) => (seat.x !== null && seat.y !== null ? [{ x: seat.x, y: seat.y, label: seat.number }] : [])),
                      muted: !pricedSections.has(s.id),
                    }
                  : { ...s, seats: positioned(s.seats), muted: !pricedSections.has(s.id) },
              ),
            ]}
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

      <section className="card p-6">
        <h2 className="eyebrow mb-1">Duplicar {noun.the}</h2>
        <p className="mb-4 text-sm text-[var(--ink-muted)]">
          Crea {noun.a} igual otro día, a la misma hora: con sus horarios, precios, mesas y porteros.
        </p>
        <ActionForm action={duplicateSessionAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="sessionId" value={session.id} />
          <label className="label">
            Día
            <input type="date" name="date" required defaultValue={nextWeek} className="field" />
          </label>
          <button type="submit" className="btn btn-dark">
            Duplicar
          </button>
        </ActionForm>
      </section>

      <ActionForm action={deleteSessionAction} confirm={`¿Borrar ${noun.the}? No se puede deshacer.`}>
        <input type="hidden" name="sessionId" value={session.id} />
        <button type="submit" className="text-sm text-[var(--danger)] hover:underline">
          Borrar {noun.one}
        </button>
      </ActionForm>
    </div>
  );
}
