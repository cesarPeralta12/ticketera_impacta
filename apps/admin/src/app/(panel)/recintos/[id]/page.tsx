import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { autoPlaceGates, boxOfPoints, isZoneLayout, resolveZones, type GatePoint, type SectionShape, type ZoneShape } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import {
  deleteSectionAction,
} from "@/lib/actions/venues";
import { SeatMapPreview, positioned } from "@/components/seat-map-preview";
import { SEATING_LABEL } from "@/lib/labels";
import { ROLES, requireStaff } from "@/lib/session";
import type { DesignerGate } from "./gate-designer";
import { MapEditor } from "./map-editor";
import type { DesignerSection } from "./seat-designer";
import type { DesignerZone } from "./zone-designer";

export const metadata: Metadata = { title: "Recinto" };

type Props = { params: Promise<{ id: string }> };

export default async function VenuePage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const venue = await prisma.venue.findFirst({
    where: { id: (await params).id, organizationId: staff.organization.id },
    include: {
      sections: {
        orderBy: { sortOrder: "asc" },
        include: {
          seats: { select: { x: true, y: true } },
          ticketTypes: { select: { _count: { select: { orderItems: true } } } },
        },
      },
      accessPoints: { orderBy: { name: "asc" }, include: { sections: { select: { id: true } }, _count: { select: { scans: true } } } },
    },
  });
  if (!venue) notFound();

  // Con ventas (cualquier orden, incluso vencida) la sección no se puede borrar ni rehacer.
  const sections = venue.sections.map((s) => ({
    ...s,
    sold: s.ticketTypes.some((t) => t._count.orderItems > 0),
    priced: s.ticketTypes.length,
  }));
  const seated: DesignerSection[] = sections
    .filter((s) => s.seatingMode === "RESERVED")
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
  const backgroundSeats = sections.flatMap((s) => (s.seatingMode === "RESERVED" ? positioned(s.seats).map((p) => ({ ...p, color: s.color })) : []));

  // Puertas: las ubicadas, y las que no (al borde de abajo, marcadas "sin ubicar").
  const gates: DesignerGate[] = venue.accessPoints.map((g) => ({
    id: g.id,
    name: g.name,
    x: g.mapX,
    y: g.mapY,
    sectionIds: g.sections.map((x) => x.id),
    scans: g._count.scans,
  }));
  const gateMarkers: (GatePoint & { auto?: boolean })[] = [
    ...gates.flatMap((g) => (g.x !== null && g.y !== null ? [{ id: g.id, name: g.name, x: g.x, y: g.y }] : [])),
    ...autoPlaceGates(gates.filter((g) => g.x === null || g.y === null)).map((g) => ({ ...g, auto: true })),
  ];
  // Todas las zonas con forma: la guardada, o la que el mapa del comprador les da hasta que las ubiques.
  const seatBoxes = seated.flatMap((s) => {
    const box = boxOfPoints(s.seats, 12);
    return box ? [box] : [];
  });
  const resolvedZones = resolveZones(zones, seatBoxes).map((r) => ({ id: r.zone.id, name: r.zone.name, color: r.zone.color, shape: r.shape, auto: r.auto }));

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
                  {SEATING_LABEL[s.seatingMode]} · {s.seatingMode === "RESERVED" ? `${s.seats.length} butacas` : `aforo ${s.capacity}`}
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
            gates={gateMarkers}
            sections={[
              ...resolvedZones.map((z) => ({ id: z.id, name: z.name, color: z.color, seats: [], zone: z.shape, detail: `Aforo ${zones.find((c) => c.id === z.id)?.capacity ?? ""}` })),
              ...seated.map((sec) => ({ id: sec.id, name: sec.name, color: sec.color, seats: sec.seats })),
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
            {gates.map((g) => (
              <li key={g.id}>Puerta: {g.name}</li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="space-y-3">
          <h2 className="eyebrow">Mapa del recinto</h2>
          <MapEditor
            venueId={venue.id}
            seated={seated}
            zones={zones}
            resolvedZones={resolvedZones}
            gates={gates}
            gateMarkers={gateMarkers}
            seats={backgroundSeats}
            sections={sections.map((x) => ({ id: x.id, name: x.name, color: x.color }))}
          />
        </section>
      )}
    </div>
  );
}
