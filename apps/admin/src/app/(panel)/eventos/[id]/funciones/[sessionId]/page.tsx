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
  sellableCapacity,
  sessionNoun,
  sessionTimesInput,
  timeZoneLabel,
  utcToZonedInput,
  withPhases,
  type PhaseState,
  type SaleState,
  type ZoneShape,
} from "@ticketera/core";
import { getSessionStock, getZoneAvailability, prisma, salesCutoff } from "@ticketera/db";
import { AccessMethodsField } from "@/components/access-methods-field";
import { TicketTypeForm } from "@/components/ticket-type-form";
import { ActionForm } from "@/components/action-form";
import { CountUp } from "@/components/count-up";
import { Help } from "@/components/help";
import { ICONS, type NavIcon } from "@/components/icons";
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
import { setPhaseStartAction } from "@/lib/actions/phases";
import { PhasesForm } from "@/components/phases-form";
import { SessionSellersCard } from "@/components/session-sellers-card";
import { ProgramEditor } from "@/components/program-editor";
import { PrintedCard } from "./printed-card";
import { SessionTimesFields } from "@/components/session-times-fields";
import { seatingLabel } from "@/lib/labels";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Función" };

const SALE_STATE: Record<SaleState, { text: string; className: string }> = {
  open: { text: "A la venta", className: "bg-[var(--success-soft)] text-[var(--success)]" },
  scheduled: { text: "Programada", className: "bg-[var(--info-soft)] text-[var(--info)]" },
  closed: { text: "Terminada", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
};

const PHASE_STATE: Record<PhaseState, { text: string; className: string }> = {
  active: { text: "Se vende ahora", className: "bg-[var(--success-soft)] text-[var(--success)]" },
  upcoming: { text: "Todavía no", className: "bg-[var(--info-soft)] text-[var(--info)]" },
  done: { text: "Terminada", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
};

const TABS = [
  { key: "precios", label: "Precios" },
  { key: "horarios", label: "Horarios y programa" },
  { key: "impresas", label: "Impresas" },
  { key: "mas", label: "Más opciones" },
] as const;
type Tab = (typeof TABS)[number]["key"];

type Props = { params: Promise<{ id: string; sessionId: string }>; searchParams: Promise<{ tab?: string }> };

/** Acceso rápido: ícono de color, nombre, un dato y una línea corta. */
function Shortcut({ href, icon, label, note, value, tone, primary }: { href: string; icon: NavIcon; label: string; note: string; value?: string; tone: "blue" | "magenta" | "amber"; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`card group flex items-center gap-3 p-3.5 ${primary ? "border-[var(--accent)]" : ""}`}
      title={note}
    >
      <span className={`tone-${tone} tone-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm`}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={ICONS[icon]} />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{label}</span>
          {value && <span className="shrink-0 font-mono text-xs text-[var(--ink-muted)]">{value}</span>}
        </span>
        <span className="block truncate text-xs text-[var(--ink-dim)]">{note}</span>
      </span>
    </Link>
  );
}

export default async function SessionPage({ params, searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id, sessionId } = await params;
  const requested = (await searchParams).tab;

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

  const [stock, zones, guests, issued, entered, held] = await Promise.all([
    getSessionStock(session.id),
    getZoneAvailability(session.id),
    prisma.ticket.count({ where: { sessionId: session.id, order: { channel: "GUEST" }, status: { in: ["VALID", "USED"] } } }),
    prisma.ticket.count({ where: { sessionId: session.id, status: { in: ["VALID", "USED"] } } }),
    prisma.ticket.count({ where: { sessionId: session.id, status: "USED" } }),
    prisma.seatHoldSeat.count({ where: { sessionId: session.id } }),
  ]);
  const guestList = session.event.mode === "GUEST_LIST";
  const tabs = TABS.filter((t) => !(guestList && t.key === "impresas"));
  const tab: Tab = tabs.some((t) => t.key === requested) ? (requested as Tab) : "precios";
  const base = `/eventos/${id}/funciones/${session.id}`;
  const tabHref = (key: Tab) => (key === "precios" ? base : `${base}?tab=${key}`);

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
  const remaining = stock.remaining;
  // Las fases ya traen su ventana ajustada: una terminada figura cerrada y una que no empezó, programada.
  const types = withPhases(session.ticketTypes, stock, now);
  const phased = types.filter((t) => t.phase);
  const phaseChains = [...new Set(phased.map((t) => t.sectionId))].map((sectionId) =>
    phased.filter((t) => t.sectionId === sectionId).toSorted((a, b) => a.phase!.position - b.phase!.position),
  );
  // Secciones generales donde todavía se pueden crear fases (una cadena por sección).
  const phaseSections = session.venue.sections.filter(
    (s) => s.seatingMode === "GENERAL_ADMISSION" && !phaseChains.some((chain) => chain[0]!.sectionId === s.id),
  );
  const nightlife = session.event.category === "BOLICHE";
  const noun = sessionNoun(session.event.category);
  const hasConsumption = session.ticketTypes.some((t) => t.kind === "TABLE" || (t.consumptionAmount ?? 0) > 0);
  const hasTables = session.ticketTypes.some((t) => t.kind === "TABLE") || seatedSections.some((s) => isTablesLayout(s.layout) || isSeatedTablesLayout(s.layout));
  const nextWeek = utcToZonedInput(new Date(session.startsAt.getTime() + 7 * 86_400_000), tz).slice(0, 10);
  const capacity = sellableCapacity(session.ticketTypes);
  // Misma regla que la boletería: evento publicado con venta y la función todavía vendible en puerta.
  const boxOffice = !guestList && session.event.status === "PUBLISHED" && !session.cancelledAt && salesCutoff(session, "POS") > now;

  const stats = [
    { label: "Entradas emitidas", value: issued, of: capacity > 0 ? `de ${capacity.toLocaleString("es-BO")}` : null, tone: "blue" },
    { label: "Ya ingresaron", value: entered, of: issued > 0 ? `${Math.round((entered / issued) * 100)}%` : null, tone: "magenta" },
    { label: guestList ? "Invitados" : "Invitaciones", value: guests, of: null, tone: "amber" },
    ...(!guestList && seatedSections.length > 0 ? [{ label: "Lugares apartados", value: held, of: null, tone: "blue" }] : []),
  ];

  return (
    <div className="space-y-6">
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

      <dl className="stats grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`card tone-${s.tone} p-4`}>
            <dt className="eyebrow">{s.label}</dt>
            <dd className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tabular-nums">
                <CountUp value={s.value} />
              </span>
              {s.of && <span className="text-xs text-[var(--ink-dim)]">{s.of}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-label="Accesos rápidos" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Shortcut href={`${base}/en-vivo`} icon="door" label="Ingreso en vivo" note="Mapa y lecturas de las puertas al momento" tone="magenta" primary />
        {boxOffice && <Shortcut href={`/boleteria/${session.id}`} icon="ticket" label="Boletería" note="Vender en la puerta o en un punto de venta" tone="amber" />}
        <Shortcut
          href={`${base}/invitados`}
          icon="users"
          label={guestList ? "Lista de invitados" : "Invitaciones"}
          note={guestList ? "Carga a los invitados: cada uno recibe su QR" : "Cortesías con QR propio"}
          value={`${guests}`}
          tone="magenta"
        />
        {!guestList && seatedSections.length > 0 && (
          <Shortcut href={`${base}/retenciones`} icon="tag" label="Retenciones" note="Aparta lugares con un código" value={`${held}`} tone="blue" />
        )}
        {hasTables && <Shortcut href={`/boleteria/${session.id}/mesas`} icon="map" label="Mesas (anfitriones)" note="Cada mesa en vivo: libre, vendida u ocupada" tone="blue" />}
        {nightlife && hasConsumption && <Shortcut href={`/barra/${session.id}`} icon="glass" label="Barra (consumos)" note="Descuenta el consumo de mesas y entradas" tone="amber" />}
      </section>

      <nav aria-label={`Secciones de ${noun.the}`} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-[var(--border)]">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm ${
              tab === t.key ? "border-[var(--accent)] font-semibold text-[var(--ink)]" : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            {t.label}
            {t.key === "precios" && session.ticketTypes.length > 0 && <span className="ml-1.5 text-xs text-[var(--ink-dim)]">{session.ticketTypes.length}</span>}
          </Link>
        ))}
      </nav>

      {tab === "precios" && (
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="eyebrow flex items-center gap-2">
                Precios (tipos de entrada)
                <Help title="Precios">
                  Cada precio se vende en una sección del recinto. Varios precios pueden compartir una sección general (ej.
                  Preventa y General): juntos nunca superan su aforo. Toca un precio para cambiar cómo se lee en la puerta, si
                  permite reingreso y sus fechas de venta.
                </Help>
              </h2>
            </div>

            {unpriced.length > 0 && session.venue.sections.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-[var(--warn-soft)] px-3 py-2.5 text-sm text-[var(--warn)]">
                <span className="font-medium">{unpriced.length === 1 ? "Sin precio (no se vende):" : `${unpriced.length} secciones sin precio (no se venden):`}</span>
                {unpriced.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    {s.name}
                  </span>
                ))}
              </div>
            )}

            {session.ticketTypes.length === 0 ? (
              <p className="card p-5 text-sm text-[var(--ink-muted)]">Todavía no hay precios. Agrega el primero abajo: sección, nombre, precio y cupo.</p>
            ) : (
              <ul className="space-y-2.5">
                {types.map((t) => {
                  const price = currentPrice(t, now);
                  const left = remaining.get(t.id) ?? 0;
                  const percent = t.capacity > 0 ? Math.min(100, Math.round(((t.capacity - left) / t.capacity) * 100)) : 0;
                  const state = SALE_STATE[saleState(effectiveSaleWindow(t, session))];
                  return (
                    <li key={t.id} className="card overflow-hidden">
                      <details className="group">
                        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-2 p-4 hover:bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] [&::-webkit-details-marker]:hidden">
                          <span className="min-w-48 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{t.name}</span>
                              {t.phase && (
                                <span className="badge bg-[var(--accent-soft)] text-[var(--accent-hover)]">
                                  fase {t.phase.position} de {t.phase.total}
                                </span>
                              )}
                              {t.presale && <span className="badge bg-[var(--warn-soft)] text-[var(--warn)]">preventa</span>}
                              {t.qrMode === "DYNAMIC" && <span className="badge bg-[var(--info-soft)] text-[var(--info)]">QR dinámico</span>}
                              {t.kind === "TABLE" && <span className="badge bg-[var(--accent-soft)] text-[var(--accent-hover)]">mesa · {t.peoplePerUnit} personas</span>}
                              {t.maxEntries !== 1 && (
                                <span className="badge bg-[var(--info-soft)] text-[var(--info)]">{t.maxEntries === 0 ? "con reingreso" : `${t.maxEntries} ingresos`}</span>
                              )}
                            </span>
                            <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                              {t.section ? `${t.section.name} · ${seatingLabel(t.section)}` : "Sin sección"}
                              {(t.consumptionAmount ?? 0) > 0 && ` · consumo ${formatMoney(t.consumptionAmount!, t.currency)}${t.kind === "TABLE" ? " por mesa" : ""}`}
                              {t.entryUntil && ` · entra hasta las ${formatClock(t.entryUntil, tz)}`}
                            </span>
                          </span>
                          <span className="text-right">
                            <span className="block font-mono text-lg font-semibold">{formatMoney(price.unitAmount, t.currency)}</span>
                            {price.discountPercent ? (
                              <span className="block text-xs text-[var(--warn)]">
                                -{t.discountPercent}% · lista {formatMoney(t.unitAmount, t.currency)}
                              </span>
                            ) : t.discountPercent ? (
                              <span className="block text-xs text-[var(--ink-dim)]">
                                {t.discountEndsAt && t.discountEndsAt <= now ? "descuento terminado" : `-${t.discountPercent}% programado`}
                              </span>
                            ) : null}
                          </span>
                          <span className="w-36">
                            <span className="flex justify-between font-mono text-xs">
                              <span>
                                quedan <strong>{left}</strong>
                              </span>
                              <span className="text-[var(--ink-dim)]">de {t.capacity}</span>
                            </span>
                            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                              <span className="block h-full rounded-full" style={{ width: `${percent}%`, background: left === 0 ? "var(--danger)" : "var(--grad-brand)" }} />
                            </span>
                          </span>
                          <span className="flex items-center gap-3">
                            <span className={`badge ${state.className}`}>{state.text}</span>
                            <span className="text-xs text-[var(--accent)]">
                              <span className="group-open:hidden">Ajustes ▾</span>
                              <span className="hidden group-open:inline">Cerrar ▴</span>
                            </span>
                          </span>
                        </summary>

                        <div className="grid gap-5 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_35%,transparent)] p-4 text-sm lg:grid-cols-3">
                          <div className="space-y-2">
                            <p className="eyebrow">Lectura en puerta</p>
                            {t.qrMode === "DYNAMIC" ? (
                              <p className="text-xs text-[var(--ink-muted)]">Solo QR que cambia cada 30 segundos: se abre en el celular, no se imprime ni se vende en boletería.</p>
                            ) : (
                              <ActionForm action={updateAccessMethodsAction} successMessage="Guardado." className="flex flex-col gap-2">
                                <input type="hidden" name="ticketTypeId" value={t.id} />
                                <AccessMethodsField defaultValue={t.accessMethods} />
                                <button type="submit" className="btn w-fit px-2.5 py-1 text-xs">
                                  Guardar
                                </button>
                              </ActionForm>
                            )}
                            {t._count.orderItems === 0 && session.event.mode === "TICKETING" && (
                              <ActionForm action={setQrModeAction} successMessage="Guardado.">
                                <input type="hidden" name="ticketTypeId" value={t.id} />
                                <input type="hidden" name="mode" value={t.qrMode === "DYNAMIC" ? "STATIC" : "DYNAMIC"} />
                                <button type="submit" className="text-xs text-[var(--accent)] hover:underline">
                                  {t.qrMode === "DYNAMIC" ? "Volver a QR fijo" : "Usar QR dinámico (contra capturas)"}
                                </button>
                              </ActionForm>
                            )}
                          </div>

                          <div className="space-y-2">
                            <p className="eyebrow">Ingresos y zonas</p>
                            <ActionForm action={updateEntryRulesAction} successMessage="Guardado." className="flex flex-col gap-2 text-xs">
                              <input type="hidden" name="ticketTypeId" value={t.id} />
                              <fieldset>
                                <legend className="mb-1.5 text-[var(--ink-muted)]">Reingreso</legend>
                                <div className="flex gap-4 text-sm">
                                  <label className="flex items-center gap-1.5">
                                    <input type="radio" name="maxEntries" value={1} defaultChecked={t.maxEntries === 1} className="accent-[var(--accent)]" /> No
                                  </label>
                                  <label className="flex items-center gap-1.5">
                                    <input type="radio" name="maxEntries" value={0} defaultChecked={t.maxEntries !== 1} className="accent-[var(--accent)]" /> Sí
                                  </label>
                                </div>
                                <p className="mt-1 text-[var(--ink-dim)]">
                                  {t.maxEntries > 1 ? `Hoy: hasta ${t.maxEntries} ingresos. ` : ""}Con «Sí», al salir y al volver se lee el mismo QR en la puerta.
                                </p>
                              </fieldset>
                              {session.venue.zones.length > 0 && (
                                <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
                                  <legend className="mb-1 text-[var(--ink-muted)]">Zonas que abre (ninguna = las de siempre)</legend>
                                  {session.venue.zones.map((z) => (
                                    <label key={z.id} className="flex items-center gap-1">
                                      <input type="checkbox" name="zoneIds" value={z.id} defaultChecked={t.zones.some((x) => x.id === z.id)} />
                                      <span className="h-2 w-2 rounded-full" style={{ background: z.color }} />
                                      {z.name}
                                    </label>
                                  ))}
                                </fieldset>
                              )}
                              <button type="submit" className="btn w-fit px-2.5 py-1 text-xs">
                                Guardar reglas
                              </button>
                            </ActionForm>
                          </div>

                          {/* La primera fase usa sus fechas de venta; las siguientes empiezan según «Fases de venta». */}
                          {t.phase && t.phase.position > 1 ? (
                            <div className="space-y-2">
                              <p className="eyebrow">Fechas</p>
                              <p className="text-xs text-[var(--ink-muted)]">
                                Es la fase {t.phase.position} de {t.phase.total}: cuándo empieza se cambia en «Fases de venta», más arriba.
                              </p>
                            </div>
                          ) : (
                          <div className="space-y-2">
                            <p className="eyebrow">Fechas y preventa</p>
                            <p className="text-xs text-[var(--ink-muted)]">
                              {inheritsSaleWindow(t)
                                ? `Se vende igual que ${noun.the}.`
                                : [t.salesStartAt && `Desde ${formatDateTime(t.salesStartAt, tz)}`, t.salesEndAt && `hasta ${formatDateTime(t.salesEndAt, tz)}`]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </p>
                            <ActionForm action={updateTicketTypeSalesAction} successMessage="Fechas guardadas." className="grid grid-cols-2 gap-2 text-xs">
                              <input type="hidden" name="ticketTypeId" value={t.id} />
                              <label className="col-span-2 flex items-center gap-2">
                                <input type="checkbox" name="presale" defaultChecked={t.presale} /> Es preventa
                              </label>
                              <label className="label">
                                Desde
                                <input type="datetime-local" name="salesStartAt" defaultValue={t.salesStartAt ? utcToZonedInput(t.salesStartAt, tz) : ""} className="field text-xs" />
                              </label>
                              <label className="label">
                                Hasta
                                <input type="datetime-local" name="salesEndAt" defaultValue={t.salesEndAt ? utcToZonedInput(t.salesEndAt, tz) : ""} className="field text-xs" />
                              </label>
                              <label className="label col-span-2">
                                Descuento de preventa (%)
                                <input name="discountPercent" inputMode="numeric" defaultValue={t.discountPercent ?? ""} placeholder="sin descuento" className="field w-32 text-xs" />
                              </label>
                              <label className="label">
                                Descuento desde
                                <input
                                  type="datetime-local"
                                  name="discountStartsAt"
                                  defaultValue={t.discountStartsAt ? utcToZonedInput(t.discountStartsAt, tz) : ""}
                                  className="field text-xs"
                                />
                              </label>
                              <label className="label">
                                Descuento hasta
                                <input type="datetime-local" name="discountEndsAt" defaultValue={t.discountEndsAt ? utcToZonedInput(t.discountEndsAt, tz) : ""} className="field text-xs" />
                              </label>
                              <button type="submit" className="btn col-span-2 w-fit px-2.5 py-1 text-xs">
                                Guardar fechas
                              </button>
                            </ActionForm>
                          </div>
                          )}

                          {t._count.orderItems === 0 && (
                            <div className="lg:col-span-3">
                              <ActionForm action={deleteTicketTypeAction} confirm={`¿Borrar "${t.name}"?`}>
                                <input type="hidden" name="ticketTypeId" value={t.id} />
                                <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                                  Borrar este precio
                                </button>
                              </ActionForm>
                            </div>
                          )}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {!guestList && (phaseChains.length > 0 || phaseSections.length > 0) && (
            <section className="space-y-3" id="fases">
              <h2 className="eyebrow flex items-center gap-2">
                Fases de venta
                <Help title="Fases de venta">
                  Fase Hot, Fase 1, Fase 2… en una misma sección, cada una con su precio y su cupo. Se vende una sola a la vez:
                  la siguiente empieza cuando se agota la anterior o cuando llega su fecha (lo que pase primero), y una fase
                  que terminó no vuelve. En la web el comprador ve la fase de ahora y la lista de todas las fases.
                </Help>
              </h2>
              {phaseChains.map((chain) => {
                const active = chain.find((t) => t.phase!.state === "active");
                const following = active && chain.find((t) => t.phase!.position === active.phase!.position + 1);
                return (
                  <div key={chain[0]!.id} className="card overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
                      <span className="flex items-center gap-2 font-medium">
                        <span className="h-3 w-3 rounded-full" style={{ background: chain[0]!.section?.color }} />
                        {chain[0]!.section?.name ?? "Sin sección"}
                      </span>
                      {active && following && (
                        <ActionForm action={setPhaseStartAction} confirm={`¿Terminar "${active.name}" y empezar a vender "${following.name}" ahora?`}>
                          <input type="hidden" name="ticketTypeId" value={following.id} />
                          <input type="hidden" name="now" value="1" />
                          <button type="submit" className="btn px-3 py-1 text-xs">
                            Pasar a «{following.name}» ahora
                          </button>
                        </ActionForm>
                      )}
                    </div>
                    <ol className="divide-y divide-[var(--border)]">
                      {chain.map((t) => {
                        const phase = t.phase!;
                        const left = remaining.get(t.id) ?? 0;
                        const sold = Math.max(0, t.capacity - left);
                        const state = PHASE_STATE[phase.state];
                        return (
                          <li key={t.id} className={`flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm ${phase.state === "done" ? "opacity-60" : ""}`}>
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold ${phase.state === "active" ? "tone-magenta tone-tile" : "bg-[var(--surface-2)] text-[var(--ink-muted)]"}`}
                            >
                              {phase.position}
                            </span>
                            <span className="min-w-40 flex-1">
                              <span className="block font-medium">{t.name}</span>
                              <span className="block text-xs text-[var(--ink-dim)]">
                                {phase.position === 1
                                  ? t.salesStartAt && t.salesStartAt > now
                                    ? `Se vende desde ${formatDateTime(t.salesStartAt, tz)}`
                                    : "Se vende primero"
                                  : t.phaseStartsAt && t.phaseStartsAt <= now
                                    ? `Empezó el ${formatDateTime(t.phaseStartsAt, tz)}`
                                    : t.phaseStartsAt
                                      ? `Al agotarse la anterior o el ${formatDateTime(t.phaseStartsAt, tz)}`
                                      : "Cuando se agota la anterior"}
                              </span>
                            </span>
                            <span className="font-mono font-semibold">{formatMoney(t.unitAmount, t.currency)}</span>
                            <span className="w-28 font-mono text-xs">
                              {sold} de {t.capacity}
                              <span className="block text-[var(--ink-dim)]">{left === 0 ? "agotada" : `quedan ${left}`}</span>
                            </span>
                            <span className={`badge ${state.className}`}>{state.text}</span>
                            {phase.position > 1 && phase.state === "upcoming" && (
                              <ActionForm action={setPhaseStartAction} successMessage="Guardado." className="flex basis-full flex-wrap items-end gap-2 text-xs sm:pl-13">
                                <input type="hidden" name="ticketTypeId" value={t.id} />
                                <label className="label">
                                  Empieza el (vacío: cuando se agote la anterior)
                                  <input
                                    type="datetime-local"
                                    name="startsAt"
                                    defaultValue={t.phaseStartsAt ? utcToZonedInput(t.phaseStartsAt, tz) : ""}
                                    className="field text-xs"
                                  />
                                </label>
                                <button type="submit" className="btn px-2.5 py-1 text-xs">
                                  Guardar fecha
                                </button>
                              </ActionForm>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                );
              })}
              {session.event.mode === "TICKETING" && phaseSections.length > 0 && (
                <details className="card group">
                  <summary className="flex cursor-pointer list-none items-center justify-between p-4 [&::-webkit-details-marker]:hidden">
                    <span className="font-medium text-[var(--accent)]">+ Crear fases</span>
                    <span className="text-xs text-[var(--ink-dim)] group-open:hidden">Fase Hot, Fase 1, Fase 2… una después de la otra</span>
                  </summary>
                  <div className="border-t border-[var(--border)] p-4">
                    <PhasesForm sessionId={session.id} sections={phaseSections.map((s) => ({ id: s.id, name: s.name, capacity: s.capacity }))} />
                  </div>
                </details>
              )}
            </section>
          )}

          {session.venue.sections.length === 0 ? (
            <p className="card p-5 text-sm">
              El recinto no tiene secciones.{" "}
              <Link href={`/recintos/${session.venueId}`} className="text-[var(--accent)] underline">
                Configúralo
              </Link>
              .
            </p>
          ) : (
            <details className="card group" open={session.ticketTypes.length === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between p-4 [&::-webkit-details-marker]:hidden">
                <span className="font-medium text-[var(--accent)]">+ Agregar un precio</span>
                <span className="text-xs text-[var(--ink-dim)] group-open:hidden">con modelos listos: General, VIP, Mesa, Free, Preventa</span>
              </summary>
              <div className="border-t border-[var(--border)] p-4">
                <TicketTypeForm
                  sessionId={session.id}
                  sectionOptions={sectionOptions}
                  pricedSections={pricedSections}
                  nightlife={nightlife}
                  ticketing={session.event.mode === "TICKETING"}
                  presaleEnd={suggestedPresaleEnd(utcToZonedInput(session.startsAt, tz).slice(0, 10), now, session.startsAt)}
                />
              </div>
            </details>
          )}

          {(zones.length > 0 || seatedSections.length > 0 || drawnZones.length > 0) && (
            <div className="grid items-start gap-6 lg:grid-cols-2">
              {zones.length > 0 && (
                <section className="card p-5">
                  <h2 className="eyebrow mb-3 flex items-center gap-2">
                    Aforo de las zonas de pie
                    <Help title="Aforo por zona">Cuántos lugares quedan en cada zona sin asientos, sumando todos sus precios (preventa, general…).</Help>
                  </h2>
                  <ul className="space-y-3">
                    {zones.map((z) => {
                      const pct = z.capacity === 0 ? 0 : Math.round((z.sold / z.capacity) * 100);
                      return (
                        <li key={z.id}>
                          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                            <span className="flex items-center gap-2 font-medium">
                              <span className="h-3 w-3 rounded-full" style={{ background: z.color }} />
                              {z.name}
                            </span>
                            <span className="font-mono text-xs">
                              <strong>{z.remaining}</strong> quedan <span className="text-[var(--ink-dim)]">· {z.sold}/{z.capacity} ({pct}%)</span>
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
              {(seatedSections.length > 0 || drawnZones.length > 0) && (
                <section className={`card space-y-3 p-5 ${zones.length === 0 ? "lg:col-span-2" : ""}`}>
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
                  <p className="text-xs text-[var(--ink-dim)]">Las secciones atenuadas no tienen precio en {noun.the}.</p>
                </section>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "horarios" && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section id="horarios" className="card p-6">
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
              {issued > 0 && <p className="text-xs text-[var(--warn)]">Ya hay {issued} entrada(s) emitida(s): si cambias el día o la hora, avisa a los compradores.</p>}
              <button type="submit" className="btn btn-primary w-fit">
                Guardar horarios
              </button>
            </ActionForm>
          </section>
          <section className="card p-6">
            <h2 className="eyebrow mb-1 flex items-center gap-2">
              Programa
              <Help title="Programa">Quién toca y a qué hora. Es opcional: se muestra en la web y en la entrada.</Help>
            </h2>
            <ActionForm action={updateProgramAction} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="sessionId" value={session.id} />
              <ProgramEditor initial={parseProgram(session.program)} />
              <button type="submit" className="btn w-fit">
                Guardar programa
              </button>
            </ActionForm>
          </section>
        </div>
      )}

      {tab === "impresas" && !guestList && <PrintedCard session={session} organizationId={staff.organization.id} />}

      {tab === "mas" && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {!guestList && <SessionSellersCard session={session} organizationId={staff.organization.id} canEdit={staff.platform && !staff.readOnly} />}
          {!guestList && (
            <section className="card p-6">
              <h2 className="eyebrow mb-4 flex items-center gap-2">
                Cola virtual
                <Help title="Cola virtual">
                  Para ventas de alta demanda: los compradores esperan en una fila y entran a comprar por turnos de 10 minutos.
                </Help>
              </h2>
              <ActionForm action={updateQueueSettingsAction} successMessage="Configuración guardada." className="flex flex-col gap-3">
                <input type="hidden" name="sessionId" value={session.id} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="queueEnabled" defaultChecked={session.queueEnabled} className="accent-[var(--accent)]" />
                  Activar sala de espera
                </label>
                <label className="label">
                  Compradores comprando a la vez
                  <input name="maxConcurrentCheckouts" type="number" min={1} defaultValue={session.maxConcurrentCheckouts ?? undefined} placeholder="ej. 50" className="field w-40" />
                </label>
                <button type="submit" className="btn w-fit">
                  Guardar
                </button>
              </ActionForm>
            </section>
          )}
          <section className="card p-6">
            <h2 className="eyebrow mb-1">Duplicar {noun.the}</h2>
            <p className="mb-4 text-sm text-[var(--ink-muted)]">Otro día a la misma hora, con sus horarios, precios, mesas y porteros.</p>
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
          <section className="card p-6 lg:col-span-2" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, var(--border))" }}>
            <h2 className="mb-1 font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-[var(--danger)]">Zona de peligro</h2>
            <p className="mb-3 text-sm text-[var(--ink-muted)]">Borrar {noun.the} no se puede deshacer.</p>
            <ActionForm action={deleteSessionAction} confirm={`¿Borrar ${noun.the}? No se puede deshacer.`}>
              <input type="hidden" name="sessionId" value={session.id} />
              <button type="submit" className="rounded-md border border-[var(--danger)]/40 px-4 py-2 text-sm font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger-soft)]">
                Borrar {noun.one}
              </button>
            </ActionForm>
          </section>
        </div>
      )}
    </div>
  );
}
