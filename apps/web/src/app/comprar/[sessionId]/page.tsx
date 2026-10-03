import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { MAX_TICKETS_PER_ORDER, formatDateTime } from "@ticketera/core";
import { getQueueStatus, getSessionAvailability, getTakenSeatIds, prisma } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { queueCookieName } from "@/lib/queue-cookie";
import { CheckoutForm, type GeneralType, type SeatedType } from "./checkout-form";
import { TurnCountdown } from "./turn-countdown";

export const metadata: Metadata = { title: "Comprar entradas" };

type Props = { params: Promise<{ sessionId: string }> };

export default async function BuyPage({ params }: Props) {
  await connection();
  const { sessionId } = await params;

  const session = await prisma.eventSession.findUnique({
    where: { id: sessionId },
    include: {
      event: true,
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
    session.cancelledAt ||
    session.startsAt <= new Date()
  ) {
    notFound();
  }

  // Cola virtual: sin turno vigente, a la sala de espera. (createPendingOrder lo vuelve a
  // verificar: esto es para la experiencia, no la protección.)
  let turnEndsAt: Date | undefined;
  if (session.queueEnabled) {
    const token = (await cookies()).get(queueCookieName(session.id))?.value;
    const status = token ? await getQueueStatus(session.id, token) : null;
    if (status?.state !== "admitted") redirect(`/comprar/${session.id}/espera`);
    turnEndsAt = status.expiresAt;
  }

  const [remaining, taken, account] = await Promise.all([
    getSessionAvailability(session.id),
    getTakenSeatIds(session.id),
    auth(),
  ]);

  const general: GeneralType[] = session.ticketTypes
    .filter((t) => t.section?.seatingMode !== "RESERVED")
    .map((t) => ({
      id: t.id,
      name: t.name,
      detail: t.section ? `${t.section.name} · Entrada general` : null,
      unitAmount: t.unitAmount,
      currency: t.currency,
      max: Math.min(remaining.get(t.id) ?? 0, t.maxPerOrder, MAX_TICKETS_PER_ORDER),
    }));

  const seated: SeatedType[] = session.ticketTypes
    .filter((t) => t.section?.seatingMode === "RESERVED")
    .map((t) => ({
      ticketTypeId: t.id,
      name: t.section!.name,
      color: t.section!.color,
      unitAmount: t.unitAmount,
      currency: t.currency,
      maxPerOrder: Math.min(t.maxPerOrder, MAX_TICKETS_PER_ORDER),
      seats: t.section!.seats
        // Orden de lectura natural (fila A: 1, 2, … 10), no alfabético ("1", "10", "2").
        .toSorted((a, b) => a.row.localeCompare(b.row) || Number(a.number) - Number(b.number) || a.number.localeCompare(b.number))
        .flatMap((s) =>
          s.x !== null && s.y !== null ? [{ id: s.id, label: s.label, x: s.x, y: s.y, taken: taken.has(s.id) }] : [],
        ),
    }))
    .filter((t) => t.seats.length > 0);

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
          buyer={account?.user ? { name: account.user.name ?? "", email: account.user.email ?? "" } : undefined}
        />
      )}
    </main>
  );
}
