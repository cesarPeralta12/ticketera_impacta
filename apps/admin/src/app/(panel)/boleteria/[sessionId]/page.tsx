import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { MAX_TICKETS_PER_ORDER, currentPrice, discountLabel, formatDateTime, saleState, isSeatedTablesLayout, isTablesLayout, mapItemsOf } from "@ticketera/core";
import { getSessionAvailability, getTakenSeatIds, listSeatHolds, prisma, salesCutoff } from "@ticketera/db";
import { ROLES, requireStaff } from "@/lib/session";
import { PosForm, type PosGeneralType, type PosSeatedType } from "./pos-form";

export const metadata: Metadata = { title: "Vender" };

type Props = { params: Promise<{ sessionId: string }> };

/** ¿La boletería todavía puede vender esta función? */
function onSale(session: { startsAt: Date; endsAt: Date | null }) {
  return salesCutoff(session, "POS") > new Date();
}

export default async function PosSessionPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.pos);
  const session = await prisma.eventSession.findFirst({
    where: {
      id: (await params).sessionId,
      cancelledAt: null,
      event: { organizationId: staff.organization.id, status: "PUBLISHED", mode: "TICKETING" },
    },
    include: {
      event: true,
      venue: true,
      ticketTypes: {
        orderBy: { sortOrder: "asc" },
        include: { section: { include: { seats: { orderBy: [{ row: "asc" }, { number: "asc" }] } } } },
      },
    },
  });
  if (!session || !onSale(session)) notFound();

  const [remaining, taken, holds] = await Promise.all([getSessionAvailability(session.id), getTakenSeatIds(session.id), listSeatHolds(session.id)]);
  // Retenciones: la boletería las vende, pero el cajero las ve con el color de su retención.
  const heldBy = new Map(holds.flatMap((h) => h.seats.map((seat) => [seat.seatId, { name: h.name, color: h.color }] as const)));

  // En caja se vende lo mismo que online en este momento: la preventa mientras dure, la general cuando empiece.
  // Los tipos de QR dinámico son solo online: en caja no se imprimen.
  const openTypes = session.ticketTypes.filter((t) => saleState(t) === "open" && t.qrMode === "STATIC");
  const now = new Date();
  const general: PosGeneralType[] = openTypes
    .filter((t) => t.section?.seatingMode !== "RESERVED")
    .map((t) => ({
      id: t.id,
      name: t.presale && t.salesEndAt ? `${t.name} (preventa hasta ${formatDateTime(t.salesEndAt, session.venue.timezone)})` : t.name,
      detail: t.section ? `${t.section.name} · quedan ${remaining.get(t.id) ?? 0}` : `quedan ${remaining.get(t.id) ?? 0}`,
      unitAmount: currentPrice(t, now).unitAmount,
      listAmount: currentPrice(t, now).discountPercent ? t.unitAmount : null,
      discountLabel: discountLabel(t, now, session.venue.timezone),
      currency: t.currency,
      max: Math.min(remaining.get(t.id) ?? 0, t.maxPerOrder, MAX_TICKETS_PER_ORDER),
    }));

  const seated: PosSeatedType[] = openTypes
    .filter((t) => t.section?.seatingMode === "RESERVED")
    .map((t) => ({
      ticketTypeId: t.id,
      name: t.section!.name,
      color: t.section!.color,
      unitAmount: currentPrice(t, now).unitAmount,
      discountPercent: currentPrice(t, now).discountPercent,
      currency: t.currency,
      presale: t.presale,
      maxPerOrder: Math.min(t.maxPerOrder, MAX_TICKETS_PER_ORDER),
      table: isTablesLayout(t.section!.layout) ? { radius: t.section!.layout.radius, shape: t.section!.layout.shape } : null,
      wholeTable:
        isSeatedTablesLayout(t.section!.layout) && t.section!.layout.mode === "WHOLE"
          ? { prefix: t.section!.layout.prefix, chairs: t.section!.layout.chairs }
          : null,
      seats: t.section!.seats
        .toSorted((a, b) => a.row.localeCompare(b.row) || Number(a.number) - Number(b.number) || a.number.localeCompare(b.number))
        .flatMap((s) =>
          s.x !== null && s.y !== null ? [{ id: s.id, label: s.label, x: s.x, y: s.y, taken: taken.has(s.id), short: s.number, group: s.row, held: heldBy.get(s.id) ?? null }] : [],
        ),
    }))
    .filter((t) => t.seats.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/boleteria" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Boletería
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{session.event.title}</h1>
        {session.ticketTypes.some((t) => t.kind === "TABLE" || isTablesLayout(t.section?.layout) || isSeatedTablesLayout(t.section?.layout)) && (
          <Link href={`/boleteria/${session.id}/mesas`} className="text-sm text-[var(--accent)] hover:underline">
            Ver el estado de las mesas →
          </Link>
        )}
        <p className="text-sm text-[var(--ink-muted)]">
          {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name}
        </p>
      </div>
      {general.length === 0 && seated.length === 0 ? (
        <p className="card p-5 text-sm text-[var(--ink-muted)]">Esta función no tiene entradas cargadas.</p>
      ) : staff.readOnly ? (
        <p className="card p-5 text-sm text-[var(--ink-muted)]">
          Cuenta de solo lectura: ves lo que queda a la venta, pero las ventas en boletería las hace el cajero.
        </p>
      ) : (
        <PosForm sessionId={session.id} general={general} seated={seated} items={mapItemsOf(session.venue.mapItems)} />
      )}
    </div>
  );
}
