import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { commissionLabel, formatDateTime, formatMoney, mapItemsOf } from "@ticketera/core";
import { prisma, salesCutoff } from "@ticketera/db";
import { PosForm } from "@/app/(panel)/boleteria/[sessionId]/pos-form";
import { POS_SESSION_INCLUDE, posOffer } from "@/lib/pos-offer";
import { staffCanSell } from "@/lib/sales-access";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Vender" };

/** Venta de un promotor: elige las entradas, carga al cliente y genera el cobro por QR. */
export default async function PromoterSellPage({ params }: { params: Promise<{ sessionId: string }> }) {
  await connection();
  const staff = await requireStaff(ROLES.promoter);
  const session = await prisma.eventSession.findFirst({
    where: {
      id: (await params).sessionId,
      cancelledAt: null,
      event: { organizationId: staff.organization.id, status: "PUBLISHED", mode: "TICKETING", promoters: { some: { userId: staff.id } } },
    },
    include: { ...POS_SESSION_INCLUDE, event: { include: { promoters: { where: { userId: staff.id } } } } },
  });
  if (!session || salesCutoff(session, "PROMOTER") <= new Date()) notFound();
  // Solo las funciones que tiene asignadas (y vigentes); la venta lo vuelve a verificar en el servidor.
  if (!(await staffCanSell(staff, session))) {
    return (
      <div className="space-y-4">
        <Link href="/promotor" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Mis eventos
        </Link>
        <p className="card p-5 text-sm text-[var(--ink-muted)]">No tienes asignada esta función (o tu asignación todavía no empieza o ya terminó). Pídele a iPass que te la asigne.</p>
      </div>
    );
  }
  const { general, seated } = await posOffer(session, { promoter: true });
  const rule = session.event.promoters[0]!;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/promotor" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Mis eventos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{session.event.title}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          <span className="capitalize">{formatDateTime(session.startsAt, session.venue.timezone)}</span> · {session.venue.name} · tu comisión:{" "}
          {commissionLabel(rule, (c) => formatMoney(c, staff.organization.currency))}
        </p>
      </div>
      <p className="rounded-lg border border-[var(--info)]/30 bg-[var(--info-soft)] px-4 py-3 text-sm text-[var(--info)]">
        Elige las entradas y carga los datos del cliente. Al tocar «Cobrar con QR» se le muestra un QR para pagar desde su banco: apenas paga,
        las entradas le llegan al correo y tu comisión sube. Las entradas quedan reservadas 10 minutos mientras paga.
      </p>
      {general.length === 0 && seated.length === 0 ? (
        <p className="card p-5 text-sm text-[var(--ink-muted)]">Esta función no tiene entradas a la venta ahora.</p>
      ) : (
        <PosForm sessionId={session.id} general={general} seated={seated} items={mapItemsOf(session.venue.mapItems)} promoter />
      )}
    </div>
  );
}
