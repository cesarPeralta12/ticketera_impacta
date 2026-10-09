import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { MAX_TICKETS_PER_ORDER, currentPrice, discountLabel, formatDateTime, formatMoney, isZoneLayout, saleState, type ZoneShape } from "@ticketera/core";
import { getQueueStatus, getSessionAvailability, getTakenSeatIds, getZoneAvailability, prisma } from "@ticketera/db";
import { requireBuyer } from "@/lib/customer";
import { queueCookieName } from "@/lib/queue-cookie";
import { CheckoutForm, type GeneralType, type SeatedType } from "./checkout-form";
import type { PickerZone } from "./seat-picker";
import { TurnCountdown } from "./turn-countdown";

export const metadata: Metadata = { title: "Comprar entradas" };

type Props = { params: Promise<{ sessionId: string }> };

export default async function BuyPage({ params }: Props) {
  await connection();
  const { sessionId } = await params;

  const session = await prisma.eventSession.findUnique({
    where: { id: sessionId },
    include: {
      event: { include: { organization: { select: { status: true } } } },
      venue: true,
      ticketTypes: {
        orderBy: { sortOrder: "asc" },
        include: { section: { include: { seats: { orderBy: [{ row: "asc" }, { number: "asc" }] } } } },
      },
    },
  });
  if (
    !session ||
    session.event.status !== "PUBLISHED" ||
    session.event.mode !== "TICKETING" ||
    session.event.organization.status !== "ACTIVE" ||
    session.cancelledAt ||
    session.startsAt <= new Date()
  ) {
    notFound();
  }

  // Comprar exige cuenta con carnet: sin sesión, al login; sin carnet, a completarlo (y vuelve aquí).
  const buyer = await requireBuyer(`/comprar/${session.id}`);

  // Cola virtual: sin turno vigente, a la sala de espera. (createPendingOrder lo vuelve a
  // verificar: esto es para la experiencia, no la protección.)
  let turnEndsAt: Date | undefined;
  if (session.queueEnabled) {
    const token = (await cookies()).get(queueCookieName(session.id))?.value;
    const status = token ? await getQueueStatus(session.id, token) : null;
    if (status?.state !== "admitted") redirect(`/comprar/${session.id}/espera`);
    turnEndsAt = status.expiresAt;
  }

  const [remaining, taken, zoneAvailability] = await Promise.all([
    getSessionAvailability(session.id),
    getTakenSeatIds(session.id),
    getZoneAvailability(session.id),
  ]);

  // Lo que ya terminó (una preventa vencida) no se muestra; lo que todavía no empieza, sí,
  // con su fecha (solo en generales: una butaca tiene un único precio a la vez).
  const tz = session.venue.timezone;
  const types = session.ticketTypes.filter((t) => saleState(t) !== "closed");
  const now = new Date();
  const general: GeneralType[] = types
    .filter((t) => t.section?.seatingMode !== "RESERVED")
    .map((t) => ({
      id: t.id,
      sectionId: t.sectionId,
      name: t.name,
      detail: t.section ? `${t.section.name} · Entrada general` : null,
      unitAmount: currentPrice(t, now).unitAmount,
      listAmount: currentPrice(t, now).discountPercent ? t.unitAmount : null,
      discountLabel: discountLabel(t, now, tz),
      currency: t.currency,
      left: remaining.get(t.id) ?? 0,
      max: saleState(t) === "open" ? Math.min(remaining.get(t.id) ?? 0, t.maxPerOrder, MAX_TICKETS_PER_ORDER) : 0,
      presaleUntil: t.presale && t.salesEndAt ? formatDateTime(t.salesEndAt, tz) : null,
      opensAt: saleState(t) === "scheduled" && t.salesStartAt ? formatDateTime(t.salesStartAt, tz) : null,
    }))
    // Primero lo que se puede comprar ahora (la preventa), después lo que empieza más adelante.
    .toSorted((a, b) => Number(Boolean(a.opensAt)) - Number(Boolean(b.opensAt)));

  const seated: SeatedType[] = types
    .filter((t) => t.section?.seatingMode === "RESERVED" && saleState(t) === "open")
    .map((t) => ({
      ticketTypeId: t.id,
      name: t.section!.name,
      color: t.section!.color,
      unitAmount: currentPrice(t, now).unitAmount,
      discountPercent: currentPrice(t, now).discountPercent,
      currency: t.currency,
      presale: t.presale,
      maxPerOrder: Math.min(t.maxPerOrder, MAX_TICKETS_PER_ORDER),
      seats: t.section!.seats
        // Orden de lectura natural (fila A: 1, 2, … 10), no alfabético ("1", "10", "2").
        .toSorted((a, b) => a.row.localeCompare(b.row) || Number(a.number) - Number(b.number) || a.number.localeCompare(b.number))
        .flatMap((s) =>
          s.x !== null && s.y !== null ? [{ id: s.id, label: s.label, x: s.x, y: s.y, taken: taken.has(s.id) }] : [],
        ),
    }))
    .filter((t) => t.seats.length > 0);

  // Zonas generales con forma en el mapa: una por sección, con lo que queda de TODA la zona y el precio más bajo
  // a la venta ahora. Las que no tienen forma siguen apareciendo solo en la lista.
  const zones: PickerZone[] = [];
  for (const section of new Map(types.flatMap((t) => (t.section?.seatingMode === "GENERAL_ADMISSION" && t.section ? [[t.section.id, t.section] as const] : []))).values()) {
    if (!isZoneLayout(section.layout)) continue;
    const open = types.filter((t) => t.sectionId === section.id && saleState(t) === "open");
    const cheapest = open.length ? Math.min(...open.map((t) => currentPrice(t, now).unitAmount)) : null;
    const currency = types.find((t) => t.sectionId === section.id)?.currency ?? "BOB";
    zones.push({
      sectionId: section.id,
      name: section.name,
      color: section.color,
      zone: section.layout as ZoneShape,
      left: zoneAvailability.find((z) => z.id === section.id)?.remaining ?? 0,
      capacity: section.capacity,
      fromPrice: cheapest === null ? null : `desde ${formatMoney(cheapest, currency)}`,
    });
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <Link href={`/eventos/${session.event.slug}`} className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]">
        ← {session.event.title}
      </Link>
      <header>
        <p className="eyebrow">{session.venue.name}</p>
        <h1 className="font-display text-3xl sm:text-4xl">{session.event.title}</h1>
        <p className="capitalize text-[var(--ink-muted)]">{formatDateTime(session.startsAt, session.venue.timezone)}</p>
      </header>

      {turnEndsAt && <TurnCountdown endsAt={turnEndsAt.toISOString()} sessionId={session.id} />}

      {general.length === 0 && seated.length === 0 ? (
        <p className="card p-5 text-[var(--ink-muted)]">Esta función todavía no tiene entradas a la venta.</p>
      ) : (
        <CheckoutForm
          sessionId={session.id}
          general={general}
          seated={seated}
          zones={zones}
          buyer={{ name: buyer.name, email: buyer.email, document: buyer.documentId }}
        />
      )}
    </main>
  );
}
