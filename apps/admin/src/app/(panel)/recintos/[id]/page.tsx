import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { TABLE_RADIUS, isSeatedTablesLayout, isTablesLayout, isZoneLayout, mapItemsOf, type SectionShape, type ZoneShape } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import {
  addAccessPointAction,
  addZoneAction,
  deleteAccessPointAction,
  deleteVenueAction,
  deleteZoneAction,
  updatePlanImageAction,
  updateZoneAction,
  deleteSectionAction,
  updateAccessPointSectionsAction,
  updateVenueAction,
} from "@/lib/actions/venues";
import { TIMEZONES } from "@/lib/timezones";
import { SeatMapPreview, positioned } from "@/components/seat-map-preview";
import { seatingLabel } from "@/lib/labels";
import { ROLES, isNightlife, requireStaff } from "@/lib/session";
import { ClubMapDesigner, type DesignerTableGroup } from "./club-map-designer";
import { SeatDesigner, type DesignerSection } from "./seat-designer";
import { SeatedTablesDesigner } from "./seated-tables-designer";
import { ZoneDesigner, type DesignerZone } from "./zone-designer";
import { Help } from "@/components/help";

export const metadata: Metadata = { title: "Recinto" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ editor?: string }> };

/** Los editores del mapa van en pestañas (uno a la vez) para que la página no sea interminable. */
type EditorTab = "boliche" | "plano" | "zonas" | "butacas" | "mesas";

export default async function VenuePage({ params, searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const venue = await prisma.venue.findFirst({
    where: { id: (await params).id, organizationId: staff.organization.id },
    include: {
      sections: {
        orderBy: { sortOrder: "asc" },
        include: {
          seats: { select: { id: true, number: true, x: true, y: true, _count: { select: { orderItems: true } } } },
          ticketTypes: { select: { _count: { select: { orderItems: true } } } },
        },
      },
      accessPoints: { orderBy: { name: "asc" }, include: { sections: { select: { id: true } }, _count: { select: { scans: true } } } },
      zones: { orderBy: [{ level: "asc" }, { name: "asc" }], include: { _count: { select: { inside: true, gates: true } } } },
      planImage: { select: { opacity: true, mimeType: true, updatedAt: true } },
    },
  });
  if (!venue) notFound();
  const usedBy = await prisma.eventSession.count({ where: { venueId: venue.id } });

  // Con ventas (cualquier orden, incluso vencida) la sección no se puede borrar ni rehacer.
  const sections = venue.sections.map((s) => ({
    ...s,
    sold: s.ticketTypes.some((t) => t._count.orderItems > 0),
    priced: s.ticketTypes.length,
  }));
  // Lounges en círculo: los edita el plano del boliche, no el editor de butacas.
  const tableGroups: DesignerTableGroup[] = sections
    .filter((s) => s.seatingMode === "RESERVED" && isTablesLayout(s.layout))
    .map((s) => ({
      sectionId: s.id,
      name: s.name,
      color: s.color,
      prefix: isTablesLayout(s.layout) ? s.layout.prefix : "Lounge",
      shape: isTablesLayout(s.layout) && s.layout.shape === "rect" ? ("rect" as const) : ("round" as const),
      tables: s.seats.flatMap((seat) =>
        seat.x !== null && seat.y !== null
          ? [{ id: seat.id, number: Number(seat.number), x: seat.x, y: seat.y, sold: seat._count.orderItems > 0 }]
          : [],
      ),
    }));
  const mapItems = mapItemsOf(venue.mapItems);
  const seated: DesignerSection[] = sections
    .filter((s) => s.seatingMode === "RESERVED" && !isTablesLayout(s.layout) && !isSeatedTablesLayout(s.layout))
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      layout: (s.layout as SectionShape | null) ?? null,
      seats: positioned(s.seats),
      sold: s.sold,
      priced: s.priced,
    }));

  // Zonas generales: su forma en el mapa (si la tienen) y las butacas de fondo para no pisarlas.
  const zones: DesignerZone[] = sections
    .filter((s) => s.seatingMode === "GENERAL_ADMISSION")
    .map((s) => ({ id: s.id, name: s.name, color: s.color, capacity: s.capacity, layout: isZoneLayout(s.layout) ? (s.layout as ZoneShape) : null }));
  // Plano real de fondo para calcar (lo ve solo el panel).
  const plan = venue.planImage ? { url: `/recintos/${venue.id}/fondo?v=${venue.planImage.updatedAt.getTime()}`, opacity: venue.planImage.opacity } : null;
  const backgroundSeats = sections.flatMap((s) => (s.seatingMode === "RESERVED" ? positioned(s.seats).map((p) => ({ ...p, color: s.color, sectionId: s.id })) : []));

  const tableSections = sections.filter((s) => isSeatedTablesLayout(s.layout)).length;
  const doorNames = venue.accessPoints.map((g) => g.name);
  const editors: { key: EditorTab; label: string; count: number }[] = [
    isNightlife(staff)
      ? { key: "boliche", label: "Plano del boliche", count: tableGroups.length }
      : { key: "plano", label: "Escenario y puertas", count: mapItems.length },
    { key: "zonas", label: "Zonas de pie", count: zones.length },
    { key: "butacas", label: "Butacas numeradas", count: seated.length },
    { key: "mesas", label: "Mesas con sillas", count: tableSections },
  ];
  // Sin elegir: el editor de lo que el recinto ya tiene (en un boliche, su plano).
  const requested = (await searchParams).editor;
  const editor: EditorTab =
    editors.find((e) => e.key === requested)?.key ??
    (isNightlife(staff) ? "boliche" : seated.length ? "butacas" : tableSections ? "mesas" : "zonas");

  return (
    <div className="space-y-8">
      <div>
        <Link href="/recintos" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Recintos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{venue.name}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {[venue.address, venue.city].filter(Boolean).join(", ")} · {venue.timezone}
        </p>
      </div>

      <details className="card p-6" open={!venue.directions && !venue.mapUrl && !staff.readOnly}>
        <summary className="cursor-pointer text-sm font-medium">
          Datos del recinto y cómo llegar{" "}
          <span className="font-normal text-[var(--ink-dim)]">· lo ve el comprador en la web, la entrada y el correo</span>
        </summary>
        <ActionForm action={updateVenueAction} className="mt-5 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="venueId" value={venue.id} />
          <label className="label">
            Nombre
            <input name="name" required defaultValue={venue.name} className="field" />
          </label>
          <label className="label">
            Dirección
            <input name="address" defaultValue={venue.address ?? ""} placeholder="Av. Principal 123" className="field" />
          </label>
          <label className="label">
            Ciudad
            <input name="city" defaultValue={venue.city ?? ""} placeholder="Santa Cruz de la Sierra" className="field" />
          </label>
          <label className="label">
            Zona horaria
            <select name="timezone" defaultValue={venue.timezone} className="field">
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <label className="label sm:col-span-2">
            Cómo llegar y por dónde entrar
            <textarea name="directions" rows={2} maxLength={1000} defaultValue={venue.directions ?? ""} placeholder="Frente a la plaza; el ingreso es por la puerta lateral." className="field" />
          </label>
          <label className="label sm:col-span-2">
            Enlace del mapa
            <input name="mapUrl" type="url" defaultValue={venue.mapUrl ?? ""} placeholder="https://maps.app.goo.gl/…" className="field" />
            <span className="text-xs font-normal text-[var(--ink-dim)]">En Google Maps: Compartir → Copiar vínculo.</span>
          </label>
          <label className="label">
            Estacionamiento y transporte
            <input name="parking" maxLength={500} defaultValue={venue.parking ?? ""} placeholder="Parqueo propio con cupo limitado." className="field" />
          </label>
          <label className="label">
            Accesibilidad
            <input name="accessibility" maxLength={500} defaultValue={venue.accessibility ?? ""} placeholder="Rampa en la entrada principal y baño adaptado." className="field" />
          </label>
          <button type="submit" className="btn btn-dark w-fit">
            Guardar datos
          </button>
        </ActionForm>
      </details>

      <section className="card p-6">
        <h2 className="eyebrow mb-4">Secciones</h2>
        {venue.sections.length === 0 ? (
          <p className="mb-4 text-sm text-[var(--ink-muted)]">Todavía no hay secciones.</p>
        ) : (
          <ul className="mb-5 divide-y divide-[var(--border)] text-sm">
            {sections.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 font-medium">{s.name}</span>
                <span className="text-[var(--ink-muted)]">
                  {seatingLabel(s)} · {s.seatingMode === "RESERVED" ? `${s.seats.length} ${isTablesLayout(s.layout) ? "lounges" : "butacas"}` : `aforo ${s.capacity}`}
                </span>
                {!s.sold ? (
                  <ActionForm
                    action={deleteSectionAction}
                    confirm={`¿Borrar la sección "${s.name}"?${s.priced ? ` También se quitará su precio en ${s.priced} función(es).` : ""}`}
                  >
                    <input type="hidden" name="sectionId" value={s.id} />
                    <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                      Borrar
                    </button>
                  </ActionForm>
                ) : (
                  <span className="eyebrow" title="Tiene entradas vendidas o reservadas">con ventas</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {staff.readOnly ? (
        // Solo lectura: el mapa tal como lo armó Impacta, sin los editores.
        <section className="card space-y-3 p-6">
          <h2 className="eyebrow">Mapa del recinto</h2>
          <SeatMapPreview
            items={mapItems}
            sections={[
              ...zones.flatMap((z) => (z.layout ? [{ id: z.id, name: z.name, color: z.color, seats: [], zone: z.layout, detail: `Aforo ${z.capacity}` }] : [])),
              ...seated.map((sec) => ({ id: sec.id, name: sec.name, color: sec.color, seats: sec.seats })),
              ...tableGroups.map((g) => ({
                id: g.sectionId,
                name: g.name,
                color: g.color,
                table: { radius: TABLE_RADIUS },
                seats: g.tables.map((t) => ({ x: t.x, y: t.y, label: String(t.number) })),
              })),
            ]}
          />
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--ink-muted)]">
            {zones.map((z) => (
              <li key={z.id}>
                {z.name}: aforo {z.capacity}
              </li>
            ))}
            {seated.map((sec) => (
              <li key={sec.id}>
                {sec.name}: {sec.seats.length} butacas
              </li>
            ))}
            {tableGroups.map((g) => (
              <li key={g.sectionId}>
                {g.name}: {g.tables.length} lounges
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
        <details className="card p-6" open={!plan}>
          <summary className="cursor-pointer text-sm font-medium">
            Plano de fondo para calcar <span className="font-normal text-[var(--ink-dim)]">· {plan ? "cargado" : "opcional"}; el comprador no lo ve</span>
          </summary>
          <p className="mt-3 text-sm text-[var(--ink-muted)]">
            Sube una foto o el plano del local (PNG, JPG, WebP o SVG, hasta 4 MB): aparece de fondo en los editores de abajo para
            ubicar butacas, mesas, zonas y lounges encima, a escala.
          </p>
          <ActionForm action={updatePlanImageAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="venueId" value={venue.id} />
            <label className="label">
              Imagen
              <input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="field" />
            </label>
            <label className="label">
              Opacidad (%)
              <input name="opacity" type="number" min={5} max={100} defaultValue={plan?.opacity ?? 40} className="field w-24" />
            </label>
            <button type="submit" className="btn btn-dark">
              {plan ? "Guardar" : "Subir plano"}
            </button>
          </ActionForm>
          {plan && (
            <ActionForm action={updatePlanImageAction} confirm="¿Quitar el plano de fondo?" className="mt-2">
              <input type="hidden" name="venueId" value={venue.id} />
              <input type="hidden" name="remove" value="1" />
              <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                Quitar plano de fondo
              </button>
            </ActionForm>
          )}
        </details>
        <nav aria-label="Editores del mapa" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-[var(--border)]">
          {editors.map((e) => (
            <Link
              key={e.key}
              href={`/recintos/${venue.id}?editor=${e.key}`}
              scroll={false}
              aria-current={editor === e.key ? "page" : undefined}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2 text-sm ${
                editor === e.key ? "border-[var(--accent)] font-semibold text-[var(--ink)]" : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              {e.label}
              {e.count > 0 && <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-[11px] font-medium text-[var(--ink-muted)]">{e.count}</span>}
            </Link>
          ))}
        </nav>
        {editor === "boliche" && (
          <section className="card space-y-3 p-6">
            <h2 className="eyebrow">Plano del boliche</h2>
            <p className="text-sm text-[var(--ink-muted)]">
              Ubica el escenario, las barras, el DJ, la entrada y los baños, y pon cada lounge o mesa como un círculo donde está
              en el local. El comprador ve este plano y elige su lounge tocándolo. La pista y otros sectores de pie se dibujan
              en la pestaña &ldquo;Zonas de pie&rdquo;.
            </p>
            <ClubMapDesigner
              version={`${venue.updatedAt.getTime()}-${tableGroups.map((g) => `${g.sectionId}:${g.tables.length}`).join(",")}`}
              venueId={venue.id}
              items={mapItems}
              groups={tableGroups}
              zones={zones.flatMap((z) => (z.layout ? [{ id: z.id, name: z.name, color: z.color, layout: z.layout }] : []))}
              seats={sections.flatMap((s) => (s.seatingMode === "RESERVED" && !isTablesLayout(s.layout) ? positioned(s.seats).map((p) => ({ ...p, color: s.color })) : []))}
              background={plan}
              doors={doorNames}
            />
          </section>
        )}
        {editor === "plano" && (
          <section className="card space-y-3 p-6">
            <h2 className="eyebrow">Escenario, puertas y más</h2>
            <p className="text-sm text-[var(--ink-muted)]">
              Ubica el escenario y las puertas por donde entra la gente (también barras, baños o un texto). No se venden: el
              comprador los ve en el mapa de la web para orientarse, y la puerta también sale en el mapa de &ldquo;Ingreso en
              vivo&rdquo;. Las puertas se crean abajo, en &ldquo;Puertas de acceso&rdquo;.
            </p>
            <ClubMapDesigner
              version={`${venue.updatedAt.getTime()}`}
              venueId={venue.id}
              items={mapItems}
              groups={[]}
              lounges={false}
              zones={zones.flatMap((z) => (z.layout ? [{ id: z.id, name: z.name, color: z.color, layout: z.layout }] : []))}
              seats={backgroundSeats}
              background={plan}
              doors={doorNames}
            />
          </section>
        )}
        {editor === "zonas" && (
          <section className="space-y-3">
            <h2 className="eyebrow">Zonas de entrada general (sin butacas)</h2>
            <p className="text-sm text-[var(--ink-muted)]">
              Cada zona se dibuja en el mapa con la forma que elijas (rectángulo, óvalo, trapecio o arco) y su aforo. El comprador la ve en el mismo
              mapa de las butacas y elige cuántas entradas quiere de la lista de abajo.
            </p>
            <ZoneDesigner venueId={venue.id} zones={zones} seats={backgroundSeats} background={plan} items={mapItems} />
          </section>
        )}

        {editor === "mesas" && (
          <section className="space-y-3">
            <h2 className="eyebrow">Mesas con sillas</h2>
            <p className="text-sm text-[var(--ink-muted)]">
              Para cenas, galas o shows con mesas: cada silla es un lugar numerado. Elige si la mesa se vende completa, por silla
              o de N a M sillas. Las secciones de mesas que ya creaste aparecen en &ldquo;Secciones&rdquo;.
            </p>
            <SeatedTablesDesigner
              venueId={venue.id}
              background={backgroundSeats}
              plan={plan}
              items={mapItems}
              existing={sections.flatMap((s) => (isSeatedTablesLayout(s.layout) ? [{ id: s.id, name: s.name, color: s.color, layout: s.layout }] : []))}
            />
          </section>
        )}

        {editor === "butacas" && (
          <section className="space-y-3">
            <h2 className="eyebrow">Mapa de butacas numeradas</h2>
            <SeatDesigner venueId={venue.id} background={plan} existingSections={seated} zones={zones.flatMap((z) => (z.layout ? [{ id: z.id, name: z.name, color: z.color, layout: z.layout }] : []))} items={mapItems} />
          </section>
        )}
        </>
      )}

      <section className="card p-6">
        <h2 className="eyebrow mb-2 flex items-center gap-2">
          Zonas de acceso
          <Help title="Zonas de acceso">
            Sirven para controlar áreas aparte (VIP, Súper VIP). Cada puerta «da a» una zona; en el precio de cada entrada eliges
            qué zonas abre y cuántas veces puede entrar. En «Ingreso en vivo» ves cuánta gente hay en cada zona.
          </Help>
        </h2>
        <p className="mb-4 text-sm text-[var(--ink-muted)]">
          Opcional. Para recintos con áreas que se controlan aparte (Exterior, General, VIP, Súper VIP): cada puerta da a una
          zona, cada tipo de entrada dice qué zonas abre y en vivo ves cuántas personas hay en cada una. El nivel ordena de
          afuera (0) hacia adentro.
        </p>
        {venue.zones.length > 0 && (
          <ul className="mb-5 flex flex-col gap-2">
            {venue.zones.map((zone) => (
              <li key={zone.id} className="rounded-md border border-[var(--border)] p-3">
                <ActionForm action={updateZoneAction} successMessage="Guardado." className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="zoneId" value={zone.id} />
                  <label className="label">
                    Nombre
                    <input name="name" required defaultValue={zone.name} maxLength={40} className="field w-40" />
                  </label>
                  <label className="label">
                    Nivel
                    <input name="level" type="number" min={0} max={9} defaultValue={zone.level} className="field w-20" />
                  </label>
                  <label className="label">
                    Aforo
                    <input name="capacity" type="number" min={1} defaultValue={zone.capacity ?? ""} placeholder="sin tope" className="field w-28" />
                  </label>
                  <label className="flex items-center gap-1.5 self-center text-xs" title="Con el aforo lleno, la puerta no deja entrar a la zona hasta que salga alguien. Sin marcar, el aforo solo informa.">
                    <input type="checkbox" name="blockWhenFull" defaultChecked={zone.blockWhenFull} className="accent-[var(--accent)]" /> Bloquear al llenarse
                  </label>
                  <label className="label">
                    Color
                    <input name="color" type="color" defaultValue={zone.color} className="h-[38px] w-14 cursor-pointer rounded border border-[var(--border)]" />
                  </label>
                  <button type="submit" className="btn text-xs">
                    Guardar
                  </button>
                  <span className="text-xs text-[var(--ink-dim)]">
                    {zone._count.gates} puerta(s){zone._count.inside ? ` · ${zone._count.inside} adentro ahora` : ""}
                  </span>
                </ActionForm>
                {zone._count.inside === 0 && (
                  <ActionForm action={deleteZoneAction} confirm={`¿Borrar la zona "${zone.name}"? Sus puertas quedan como ingreso general.`} className="mt-2">
                    <input type="hidden" name="zoneId" value={zone.id} />
                    <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                      Borrar zona
                    </button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addZoneAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="venueId" value={venue.id} />
          <label className="label">
            Nombre
            <input name="name" required maxLength={40} placeholder="General, VIP, Súper VIP…" className="field" />
          </label>
          <label className="label">
            Nivel
            <input name="level" type="number" min={0} max={9} defaultValue={venue.zones.length + 1} className="field w-20" />
          </label>
          <label className="label">
            Aforo (opcional)
            <input name="capacity" type="number" min={1} placeholder="ej. 80" className="field w-28" />
          </label>
          <label className="flex items-center gap-1.5 self-center text-xs" title="Con el aforo lleno, la puerta no deja entrar a la zona hasta que salga alguien.">
            <input type="checkbox" name="blockWhenFull" className="accent-[var(--accent)]" /> Bloquear al llenarse
          </label>
          <label className="label">
            Color
            <input name="color" type="color" defaultValue="#2E9E6A" className="h-[38px] w-14 cursor-pointer rounded border border-[var(--border)]" />
          </label>
          <button type="submit" className="btn">
            Agregar zona
          </button>
        </ActionForm>
      </section>

      <section className="card p-6">
        <h2 className="eyebrow mb-2 flex items-center gap-2">
          Puertas de acceso
          <Help title="Puertas">
            Cada teléfono de la app de puerta trabaja en una puerta. «Entrada» deja pasar, «Salida» registra que la persona
            salió (para poder volver a entrar si su entrada lo permite) y «Entrada y salida» decide sola según si la persona
            está adentro.
          </Help>
        </h2>
        <p className="mb-4 text-sm text-[var(--ink-muted)]">
          Marca qué secciones entran por cada puerta. Una puerta sin secciones marcadas acepta todas. Con secciones
          asignadas, una entrada solo vale en sus puertas: así, aunque se corte internet, dos puertas nunca aceptan la
          misma entrada. <strong>Dirección</strong>: una puerta de salida registra que la persona salió (para reingresar,
          si su entrada lo permite); una de &ldquo;entrada y salida&rdquo; decide sola según si la persona está adentro. Sin
          ninguna puerta de salida, las entradas con reingreso salen y vuelven por la misma puerta de entrada.
        </p>
        {venue.accessPoints.length === 0 ? (
          <p className="mb-4 text-sm text-[var(--ink-dim)]">Sin puertas cargadas.</p>
        ) : (
          <ul className="mb-5 flex flex-col gap-3">
            {venue.accessPoints.map((gate) => {
              const assigned = new Set(gate.sections.map((s) => s.id));
              return (
                <li key={gate.id} className="rounded-md border border-[var(--border)] p-4">
                  <ActionForm action={updateAccessPointSectionsAction} successMessage="Guardado." className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <input type="hidden" name="accessPointId" value={gate.id} />
                    <span className="min-w-32 font-medium">{gate.name}</span>
                    {venue.sections.map((s) => (
                      <label key={s.id} className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" name="sectionIds" value={s.id} defaultChecked={assigned.has(s.id)} />
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                        {s.name}
                      </label>
                    ))}
                    <span className="text-xs text-[var(--ink-dim)]">{assigned.size === 0 ? "(acepta todas)" : ""}</span>
                    <select name="direction" defaultValue={gate.direction} aria-label={`Dirección de ${gate.name}`} className="field w-auto text-sm">
                      <option value="IN">Entrada</option>
                      <option value="OUT">Salida</option>
                      <option value="BOTH">Entrada y salida</option>
                    </select>
                    {venue.zones.length > 0 && (
                      <select name="zoneId" defaultValue={gate.zoneId ?? ""} aria-label={`Zona de ${gate.name}`} className="field w-auto text-sm">
                        <option value="">Ingreso general</option>
                        {venue.zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            Da a: {z.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button type="submit" className="btn ml-auto text-xs">
                      Guardar
                    </button>
                  </ActionForm>
                  {gate._count.scans === 0 && (
                    <ActionForm action={deleteAccessPointAction} confirm={`¿Borrar la puerta "${gate.name}"?`} className="mt-2">
                      <input type="hidden" name="accessPointId" value={gate.id} />
                      <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                        Borrar puerta
                      </button>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <ActionForm action={addAccessPointAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="venueId" value={venue.id} />
          <label className="label">
            Nombre
            <input name="name" required placeholder="Puerta 1, Acceso VIP…" className="field" />
          </label>
          <button type="submit" className="btn">
            Agregar puerta
          </button>
        </ActionForm>
      </section>

      {!staff.readOnly && (
        <section className="card p-6" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, var(--border))" }}>
          <h2 className="eyebrow mb-1">Borrar el recinto</h2>
          {usedBy > 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">
              No se puede borrar: lo usa{usedBy === 1 ? " 1 función" : `n ${usedBy} funciones`}. Cámbialas de recinto o bórralas
              primero (las entradas vendidas y las lecturas de puerta lo necesitan).
            </p>
          ) : (
            <ActionForm action={deleteVenueAction} confirm={`¿Borrar el recinto "${venue.name}" con sus secciones, puertas y plano? No se puede deshacer.`} className="space-y-2">
              <input type="hidden" name="venueId" value={venue.id} />
              <p className="text-sm text-[var(--ink-muted)]">Ninguna función lo usa: se borra con sus secciones, butacas, puertas, zonas y plano.</p>
              <button type="submit" className="btn border-[var(--danger)] text-[var(--danger)]">
                Borrar recinto
              </button>
            </ActionForm>
          )}
        </section>
      )}
    </div>
  );
}
