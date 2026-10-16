import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  currentPrice,
  formatClock,
  formatDateTime,
  formatMoney,
  isTablesLayout,
  isZoneLayout,
  mapItemsOf,
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
import { ActionForm } from "@/components/action-form";
import { SeatMapPreview, positioned } from "@/components/seat-map-preview";
import {
  addTicketTypeAction,
  updateTicketTypeSalesAction,
  deleteSessionAction,
  deleteTicketTypeAction,
  duplicateSessionAction,
  setQrModeAction,
  updateAccessMethodsAction,
  updateQueueSettingsAction,
  updateSessionAction,
} from "@/lib/actions/events";
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
      venue: { include: { sections: { orderBy: { sortOrder: "asc" }, include: { seats: { select: { x: true, y: true, number: true } } } } } },
      ticketTypes: { orderBy: { sortOrder: "asc" }, include: { section: true, _count: { select: { orderItems: true } } } },
    },
  });
  if (!session) notFound();

  const [remaining, zones, guests, issued] = await Promise.all([
    getSessionAvailability(session.id),
    getZoneAvailability(session.id),
    prisma.ticket.count({ where: { sessionId: session.id, order: { channel: "GUEST" }, status: { in: ["VALID", "USED"] } } }),
    prisma.ticket.count({ where: { sessionId: session.id, status: { in: ["VALID", "USED"] } } }),
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
                    {s.name} — {s.seatingMode === "RESERVED" ? `${s.seats.length} ${isTablesLayout(s.layout) ? "lounges" : "butacas"}` : `aforo ${s.capacity}`}
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
              <input name="capacity" type="number" min={1} placeholder="ej. 200" className="field w-28" />
              <span className="text-xs font-normal text-[var(--ink-dim)]">En butacas y lounges, el del mapa.</span>
            </label>
            {nightlife && (
              <div className="flex basis-full flex-wrap items-end gap-3 rounded-md border border-dashed border-[#c04bff]/50 bg-[#f3e8ff]/40 p-3">
                <p className="basis-full text-sm font-medium">Boliche (opcional)</p>
                <label className="flex items-center gap-2 self-center text-sm">
                  <input type="checkbox" name="table" className="h-4 w-4" /> Es una mesa o lounge
                </label>
                <label className="label">
                  Personas por mesa
                  <input name="peoplePerUnit" type="number" min={2} max={50} placeholder="ej. 6" className="field w-28" />
                </label>
                <label className="label">
                  Consumo incluido (Bs)
                  <input name="consumption" inputMode="decimal" placeholder="ej. 1000" className="field w-32" />
                </label>
                <label className="label">
                  Válida para entrar hasta
                  <input name="entryUntil" type="time" className="field w-32" />
                </label>
                <ul className="basis-full space-y-0.5 text-xs text-[var(--ink-dim)]">
                  <li>
                    <strong>Mesa o lounge</strong>: marca la casilla, personas, consumo y el precio de la mesa. Con los
                    lounges del plano, el comprador elige el suyo; en una zona sin mapa, pon en Cupo cuántas mesas hay.
                  </li>
                  <li>
                    <strong>Entrada + trago</strong>: solo el consumo (ej. 25). <strong>Free hasta la 01:00</strong>: precio
                    0 y &ldquo;Válida para entrar hasta&rdquo; 01:00.
                  </li>
                </ul>
              </div>
            )}
            <details className="basis-full">
              <summary className="cursor-pointer text-sm font-medium text-[var(--accent)]">
                Más opciones: preventa, descuento, lectura en puerta, máximo por compra
              </summary>
              <div className="mt-3 flex flex-wrap items-end gap-3">
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
                {session.event.mode === "TICKETING" && (
                  <label className="flex items-center gap-2 self-center text-sm" title="El QR cambia cada 30 segundos y solo se lee con QR. Solo venta online (no boletería ni invitaciones).">
                    <input type="checkbox" name="qrDynamic" className="h-4 w-4 accent-[var(--accent)]" /> QR dinámico
                  </label>
                )}
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
              </div>
            </details>
            <button type="submit" className="btn btn-dark">
              Agregar
            </button>
          </ActionForm>
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
                      table: { radius: s.layout.radius },
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
