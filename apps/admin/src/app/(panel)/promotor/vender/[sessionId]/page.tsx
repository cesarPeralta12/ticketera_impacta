import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { commissionLabel, formatDateTime, formatMoney, mapItemsOf, promoLabel } from "@ticketera/core";
import { ensurePromoterCode, prisma, salesCutoff } from "@ticketera/db";
import { CopyButton } from "@/components/copy-button";
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
  const money = (c: number) => formatMoney(c, staff.organization.currency);

  // Su código personal (sin descuento) y sus ofertas: los códigos con descuento que iPass le dio, vigentes y de este evento.
  const now = new Date();
  const myCodes = await prisma.promoCode.findMany({
    where: { organizationId: staff.organization.id, promoterId: staff.id, active: true, OR: [{ eventId: null }, { eventId: session.eventId }] },
    orderBy: { createdAt: "asc" },
  });
  // Si todavía no tiene su código personal (cuentas anteriores a esta pantalla), se le crea ahora.
  const personal = myCodes.find((c) => c.discountValue === 0 && c.eventId === null) ?? (await ensurePromoterCode(prisma, staff.organization.id, { id: staff.id, name: staff.name }));
  const offers = myCodes
    .filter((c) => c.discountValue > 0 && (!c.startsAt || c.startsAt <= now) && (!c.endsAt || c.endsAt > now))
    .toSorted((a, b) => Number(b.eventId !== null) - Number(a.eventId !== null))
    .map((c) => ({ code: c.code, label: promoLabel(c, money) }));

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
      {(personal || offers.length > 0) && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            {personal && (
              <>
                Tu código: <strong className="font-mono">{personal.code}</strong>
              </>
            )}
            {offers.length > 0 && (
              <span className="block text-[var(--ink-muted)]">
                Tu oferta: {offers.map((o) => `${o.code} (${o.label})`).join(" · ")}
              </span>
            )}
          </p>
          {personal && <CopyButton text={personal.code} label="Copiar mi código" />}
        </div>
      )}
      <p className="rounded-lg border border-[var(--info)]/30 bg-[var(--info-soft)] px-4 py-3 text-sm text-[var(--info)]">
        Elige las entradas y carga los datos del cliente. Al tocar «Cobrar con QR» se le muestra un QR para pagar desde su banco: apenas paga,
        las entradas le llegan al correo y tu comisión sube. Las entradas quedan reservadas 10 minutos mientras paga.
      </p>
      {general.length === 0 && seated.length === 0 ? (
        <p className="card p-5 text-sm text-[var(--ink-muted)]">Esta función no tiene entradas a la venta ahora.</p>
      ) : (
        <PosForm sessionId={session.id} general={general} seated={seated} items={mapItemsOf(session.venue.mapItems)} promoter promoOffers={offers} />
      )}
    </div>
  );
}
