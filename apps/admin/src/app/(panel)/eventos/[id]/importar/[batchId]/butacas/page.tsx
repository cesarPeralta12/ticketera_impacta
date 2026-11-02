import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { TABLE_RADIUS, isSeatedTablesLayout, isTablesLayout, mapItemsOf, seatDotRadius } from "@ticketera/core";
import { getTakenSeatIds, listPendingSeatRows, listSeatHolds, prisma } from "@ticketera/db";
import type { MapSeat } from "@/components/seat-select-map";
import { ROLES, requireStaff, visibleEvent } from "@/lib/session";
import { AssignSeats } from "./assign-seats";

export const metadata: Metadata = { title: "Asignar butacas" };

type Props = { params: Promise<{ id: string; batchId: string }>; searchParams: Promise<{ tipo?: string }> };

/** Las filas de un borrador que vinieron sin butaca: se eligen en el mapa y se les asigna una a cada una. */
export default async function AssignSeatsPage({ params, searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id, batchId } = await params;
  const { tipo } = await searchParams;
  const event = await visibleEvent(staff, id);
  if (!event) notFound();
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId }, select: { id: true, eventId: true, fileName: true, rows: true } });
  if (!batch || batch.eventId !== event.id) notFound();
  const back = `/eventos/${event.id}/importar/${batch.id}`;

  const pending = await listPendingSeatRows(batch.id);
  const byType = new Map<string, typeof pending>();
  for (const row of pending) byType.set(row.ticketTypeId, [...(byType.get(row.ticketTypeId) ?? []), row]);
  const typeId = tipo && byType.has(tipo) ? tipo : [...byType.keys()][0];
  if (!typeId) {
    return (
      <div className="max-w-3xl space-y-4">
        <Link href={back} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Volver a la revisión
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Asignar butacas</h1>
        <p className="card p-6 text-sm text-[var(--ink-muted)]">No hay filas esperando butaca en esta importación.</p>
      </div>
    );
  }

  const rows = byType.get(typeId)!;
  const type = await prisma.ticketType.findUnique({
    where: { id: typeId },
    select: {
      name: true,
      sessionId: true,
      section: { select: { name: true, color: true, layout: true, seats: { select: { id: true, label: true, row: true, number: true, x: true, y: true } } } },
      session: { select: { venue: { select: { mapItems: true } } } },
    },
  });
  if (!type?.section) notFound();
  const [taken, holds] = await Promise.all([getTakenSeatIds(type.sessionId), listSeatHolds(type.sessionId)]);
  const holdOf = new Map(holds.flatMap((h) => h.seats.map((s) => [s.seatId, h] as const)));
  // Las butacas que otras filas de este mismo archivo ya tienen también están ocupadas.
  const inFile = new Set((batch.rows as unknown as { seatId: string | null }[]).flatMap((r) => (r.seatId ? [r.seatId] : [])));
  const section = type.section;
  const placed = section.seats.flatMap((seat) => (seat.x !== null && seat.y !== null ? [{ ...seat, x: seat.x, y: seat.y }] : []));
  const r = isTablesLayout(section.layout) ? TABLE_RADIUS : seatDotRadius(placed, isSeatedTablesLayout(section.layout) ? 6 : undefined);
  const seats: MapSeat[] = placed.map((seat) => {
    const hold = holdOf.get(seat.id);
    return {
      id: seat.id,
      label: `${section.name} · ${seat.label}`,
      section: section.name,
      row: seat.row,
      number: seat.number,
      x: seat.x,
      y: seat.y,
      sectionColor: section.color,
      r,
      sold: taken.has(seat.id) || inFile.has(seat.id),
      mark: hold ? { name: `Retención ${hold.name}`, color: hold.color } : null,
    };
  });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href={back} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Volver a la revisión
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Asignar butacas</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {batch.fileName}: estas filas vinieron sin butaca. Elige en el mapa las butacas de «{type.name}» (tocándolas, por rango o arrastrando) y se
          asignan a las filas en orden.
        </p>
      </div>
      {byType.size > 1 && (
        <ul className="flex flex-wrap gap-2 text-sm">
          {[...byType].map(([key, list]) => (
            <li key={key}>
              <Link
                href={`${back}/butacas?tipo=${key}`}
                className={`badge ${key === typeId ? "bg-[var(--accent-soft)] text-[var(--accent-hover)]" : "bg-[var(--surface-2)] text-[var(--ink-muted)]"}`}
              >
                {list[0]!.typeName} ({list.length})
              </Link>
            </li>
          ))}
        </ul>
      )}
      {seats.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--ink-muted)]">
          Esta sección no tiene butacas dibujadas en el mapa: escríbelas en el Excel (columna «Butaca o mesa») y vuelve a subirlo.
        </p>
      ) : (
        <AssignSeats
          batchId={batch.id}
          backHref={back}
          rows={rows.map((row) => ({ line: row.line, name: row.name }))}
          seats={seats}
          items={mapItemsOf(type.session.venue.mapItems)}
          readOnly={staff.readOnly}
          canDrag={staff.platform}
          holdNames={holds.map((h) => ({ name: h.name, color: h.color }))}
        />
      )}
    </div>
  );
}
