import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { TABLE_RADIUS, formatDateTime, isSeatedTablesLayout, isTablesLayout, mapItemsOf, seatDotRadius } from "@ticketera/core";
import { getTakenSeatIds, listSeatHolds, prisma, requireEnv } from "@ticketera/db";
import { ROLES, requireStaff } from "@/lib/session";
import { HoldsEditor, type HoldInfo, type HoldSeat } from "./holds-editor";

export const metadata: Metadata = { title: "Retenciones" };

type Props = { params: Promise<{ id: string; sessionId: string }> };

/** Retenciones de una función: butacas apartadas para prensa, artistas o producción, con su código para liberarlas. */
export default async function HoldsPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id, sessionId } = await params;
  const session = await prisma.eventSession.findFirst({
    where: { id: sessionId, eventId: id, event: { organizationId: staff.organization.id } },
    include: {
      event: { select: { title: true } },
      venue: {
        select: {
          name: true,
          timezone: true,
          mapItems: true,
          sections: {
            where: { seatingMode: "RESERVED" },
            orderBy: { sortOrder: "asc" },
            select: { name: true, color: true, layout: true, seats: { select: { id: true, label: true, x: true, y: true } } },
          },
        },
      },
    },
  });
  if (!session) notFound();
  const [taken, holds] = await Promise.all([getTakenSeatIds(session.id), listSeatHolds(session.id)]);
  const holdOf = new Map(holds.flatMap((h) => h.seats.map((s) => [s.seatId, h.id] as const)));
  const seats: HoldSeat[] = session.venue.sections.flatMap((section) => {
    const placed = section.seats.flatMap((seat) => (seat.x !== null && seat.y !== null ? [{ ...seat, x: seat.x, y: seat.y }] : []));
    // Butacas muy juntas: el punto se achica para que no se pisen (igual que en la web).
    const r = isTablesLayout(section.layout) ? TABLE_RADIUS : seatDotRadius(placed, isSeatedTablesLayout(section.layout) ? 6 : undefined);
    return placed.map((seat) => ({
      id: seat.id,
      label: `${section.name} · ${seat.label}`,
      x: seat.x,
      y: seat.y,
      sectionColor: section.color,
      r,
      sold: taken.has(seat.id),
      holdId: holdOf.get(seat.id) ?? null,
    }));
  });
  const web = requireEnv("WEB_URL").replace(/\/$/, "");
  const info: HoldInfo[] = holds.map((h) => ({
    id: h.id,
    name: h.name,
    color: h.color,
    code: h.code,
    seats: h.seats.length,
    link: h.code ? `${web}/comprar/${session.id}?codigo=${encodeURIComponent(h.code)}` : null,
  }));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href={`/eventos/${id}/funciones/${sessionId}`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← {session.event.title} · {formatDateTime(session.startsAt, session.venue.timezone)}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Retenciones</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Aparta butacas, mesas o sillas para prensa, artistas o producción: en la web aparecen ocupadas. Con el código de la
          retención (o su enlace) se pueden comprar; la boletería las vende igual y las ve marcadas. El color solo se ve aquí.
        </p>
      </div>
      {seats.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--ink-muted)]">Esta función no tiene butacas numeradas, mesas ni lounges en el mapa: no hay nada para apartar.</p>
      ) : (
        <HoldsEditor sessionId={session.id} seats={seats} holds={info} items={mapItemsOf(session.venue.mapItems)} readOnly={staff.readOnly} />
      )}
    </div>
  );
}
