import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { MAX_TICKETS_PER_ORDER, formatDateTime } from "@ticketera/core";
import { getSessionAvailability, getTakenSeatIds, prisma, salesCutoff } from "@ticketera/db";
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

  const [remaining, taken] = await Promise.all([getSessionAvailability(session.id), getTakenSeatIds(session.id)]);

  const general: PosGeneralType[] = session.ticketTypes
    .filter((t) => t.section?.seatingMode !== "RESERVED")
    .map((t) => ({
      id: t.id,
      name: t.name,
      detail: t.section ? `${t.section.name} · quedan ${remaining.get(t.id) ?? 0}` : `quedan ${remaining.get(t.id) ?? 0}`,
      unitAmount: t.unitAmount,
      currency: t.currency,
      max: Math.min(remaining.get(t.id) ?? 0, t.maxPerOrder, MAX_TICKETS_PER_ORDER),
    }));

  const seated: PosSeatedType[] = session.ticketTypes
    .filter((t) => t.section?.seatingMode === "RESERVED")
    .map((t) => ({
      ticketTypeId: t.id,
      name: t.section!.name,
      color: t.section!.color,
      unitAmount: t.unitAmount,
      currency: t.currency,
      maxPerOrder: Math.min(t.maxPerOrder, MAX_TICKETS_PER_ORDER),
      seats: t.section!.seats
        .toSorted((a, b) => a.row.localeCompare(b.row) || Number(a.number) - Number(b.number) || a.number.localeCompare(b.number))
        .flatMap((s) =>
          s.x !== null && s.y !== null ? [{ id: s.id, label: s.label, x: s.x, y: s.y, taken: taken.has(s.id) }] : [],
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
        <p className="text-sm text-[var(--ink-muted)]">
          {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name}
        </p>
      </div>
      {general.length === 0 && seated.length === 0 ? (
        <p className="card p-5 text-sm text-[var(--ink-muted)]">Esta función no tiene entradas cargadas.</p>
      ) : (
        <PosForm sessionId={session.id} general={general} seated={seated} />
      )}
    </div>
  );
}
