import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import {
  MAX_TICKETS_PER_ORDER,
  currentPrice,
  describeSessionTimes,
  discountLabel,
  formatClock,
  formatDateTime,
  formatMoney,
  isSeatedTablesLayout,
  isTablesLayout,
  isZoneLayout,
  mapItemsOf,
  onlineSalesEnd,
  peopleIn,
  saleState,
  whenWhere,
  type ZoneShape,
} from "@ticketera/core";
import { findHoldByCode, getHeldSeatIds, getQueueStatus, getSessionAvailability, getTakenSeatIds, getZoneAvailability, prisma } from "@ticketera/db";
import { WhenWhereBlock } from "@/components/when-where";
import { requireBuyer } from "@/lib/customer";
import { queueCookieName } from "@/lib/queue-cookie";
import { CheckoutForm, type GeneralType, type SeatedType } from "./checkout-form";
import type { PickerZone } from "./seat-picker";
import { TurnCountdown } from "./turn-countdown";

export const metadata: Metadata = { title: "Comprar entradas" };

type Props = { params: Promise<{ sessionId: string }>; searchParams: Promise<{ codigo?: string | string[] }> };

export default async function BuyPage({ params, searchParams }: Props) {
  const query = await searchParams;
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
    onlineSalesEnd(session) <= new Date()
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

  // Retenciones: lo apartado se ve ocupado, salvo las butacas de la retención cuyo código trae el enlace.
  const holdCode = typeof query.codigo === "string" ? query.codigo : undefined;
  const [remaining, sold, zoneAvailability, unlocked, held] = await Promise.all([
    getSessionAvailability(session.id),
    getTakenSeatIds(session.id),
    getZoneAvailability(session.id),
    findHoldByCode(session.id, holdCode),
    getHeldSeatIds(prisma, session.id, holdCode),
  ]);
  const taken = new Set([...sold, ...held]);

  // Lo que ya terminó (una preventa vencida) no se muestra; lo que todavía no empieza, sí,
  // con su fecha (solo en generales: una butaca tiene un único precio a la vez).
  const tz = session.venue.timezone;
  const now = new Date();
  // Tampoco una "free hasta la 01:00" cuya hora ya pasó.
  const types = session.ticketTypes.filter((t) => saleState(t) !== "closed" && !(t.entryUntil && t.entryUntil <= now));
  const general: GeneralType[] = types
    .filter((t) => t.section?.seatingMode !== "RESERVED")
    .map((t) => ({
      id: t.id,
      sectionId: t.sectionId,
      name: t.name,
      detail: t.section ? `${t.section.name} · ${t.kind === "TABLE" ? "Mesa" : "Entrada general"}` : null,
      unitAmount: currentPrice(t, now).unitAmount,
      listAmount: currentPrice(t, now).discountPercent ? t.unitAmount : null,
      discountLabel: discountLabel(t, now, tz),
      currency: t.currency,
      left: remaining.get(t.id) ?? 0,
      max: saleState(t) === "open" ? Math.min(remaining.get(t.id) ?? 0, t.maxPerOrder, MAX_TICKETS_PER_ORDER) : 0,
      presaleUntil: t.presale && t.salesEndAt ? formatDateTime(t.salesEndAt, tz) : null,
      opensAt: saleState(t) === "scheduled" && t.salesStartAt ? formatDateTime(t.salesStartAt, tz) : null,
      table: t.kind === "TABLE" ? { people: peopleIn(t) } : null,
      consumption: t.consumptionAmount && t.consumptionAmount > 0 ? formatMoney(t.consumptionAmount, t.currency) : null,
      entryUntil: t.entryUntil ? formatClock(t.entryUntil, tz) : null,
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
      table: t.kind === "TABLE" ? { people: peopleIn(t) } : null,
      round: isTablesLayout(t.section!.layout) ? { radius: t.section!.layout.radius, shape: t.section!.layout.shape } : null,
      seatedTables: isSeatedTablesLayout(t.section!.layout)
        ? (({ mode, min, max, chairs, prefix, shape, size, tables }) => ({ mode, min, max, chairs, prefix, shape, size, tables }))(t.section!.layout)
        : null,
      consumption: t.consumptionAmount && t.consumptionAmount > 0 ? formatMoney(t.consumptionAmount, t.currency) : null,
      seats: t.section!.seats
        // Orden de lectura natural (fila A: 1, 2, … 10), no alfabético ("1", "10", "2").
        .toSorted((a, b) => a.row.localeCompare(b.row) || Number(a.number) - Number(b.number) || a.number.localeCompare(b.number))
        .flatMap((s) =>
          s.x !== null && s.y !== null ? [{ id: s.id, label: s.label, x: s.x, y: s.y, taken: taken.has(s.id), short: s.number, group: s.row }] : [],
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

  const when = describeSessionTimes(session, tz, session.event.category);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <Link href={`/eventos/${session.event.slug}`} className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]">
        ← {session.event.title}
      </Link>
      <header>
        <p className="eyebrow">{session.venue.name}</p>
        <h1 className="font-display text-3xl sm:text-4xl">{session.event.title}</h1>
        <p className="text-[var(--ink-muted)] first-letter:uppercase">
          {when.day} · {when.start}
        </p>
      </header>

      {turnEndsAt && <TurnCountdown endsAt={turnEndsAt.toISOString()} sessionId={session.id} />}

      {holdCode && (
        <p role="status" className={`rounded-xl border px-4 py-3 text-sm ${unlocked ? "border-[var(--accent)]/40 bg-[var(--accent)]/10" : "border-[var(--accent-2)]/40 text-[var(--accent-2)]"}`}>
          {unlocked
            ? `Código de reserva "${unlocked.name}": sus ${unlocked._count.seats} lugares apartados están habilitados para ti en el mapa.`
            : "Ese código de reserva no es válido para esta función."}
        </p>
      )}

      <WhenWhereBlock data={whenWhere({ session, venue: session.venue, event: session.event })} />

      {general.length === 0 && seated.length === 0 ? (
        <p className="card p-5 text-[var(--ink-muted)]">Esta función todavía no tiene entradas a la venta.</p>
      ) : (
        <CheckoutForm
          sessionId={session.id}
          general={general}
          seated={seated}
          zones={zones}
          items={mapItemsOf(session.venue.mapItems)}
          buyer={{ name: buyer.name, email: buyer.email, document: buyer.documentId }}
          holdCode={unlocked ? holdCode : undefined}
        />
      )}
      {seated.length > 0 && !unlocked && (
        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-[var(--ink-muted)]">
            ¿Te dieron un código de reserva?
            <input name="codigo" maxLength={30} className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 uppercase" />
          </label>
          <button type="submit" className="rounded-lg border border-[var(--border)] px-3 py-2 hover:border-[var(--accent)]">
            Usar código
          </button>
        </form>
      )}
    </main>
  );
}
