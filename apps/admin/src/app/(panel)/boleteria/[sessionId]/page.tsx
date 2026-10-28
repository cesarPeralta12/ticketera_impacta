import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime, isSeatedTablesLayout, isTablesLayout, mapItemsOf } from "@ticketera/core";
import { canSellSession, prisma, salesAccess, salesCutoff } from "@ticketera/db";
import { POS_SESSION_INCLUDE, posOffer } from "@/lib/pos-offer";
import { ROLES, requireStaff } from "@/lib/session";
import { PosForm } from "./pos-form";

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
    include: POS_SESSION_INCLUDE,
  });
  if (!session || !onSale(session)) notFound();
  const access = await salesAccess(prisma, staff.id, staff.organization.id);
  if (!canSellSession(access, session)) {
    return (
      <div className="space-y-4">
        <Link href="/boleteria" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Boletería
        </Link>
        <p className="card p-5 text-sm text-[var(--ink-muted)]">No tienes asignada esta función: pídele a iPass que te la asigne.</p>
      </div>
    );
  }

  const { general, seated } = await posOffer(session);

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
        <PosForm sessionId={session.id} general={general} seated={seated} items={mapItemsOf(session.venue.mapItems)} methods={access.posMethods} />
      )}
    </div>
  );
}
