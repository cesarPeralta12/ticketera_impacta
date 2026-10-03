import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@ticketera/db";
import { WaitingRoom } from "./waiting-room";

export const metadata: Metadata = { title: "Sala de espera", robots: { index: false } };

type Props = { params: Promise<{ sessionId: string }> };

export default async function WaitingRoomPage({ params }: Props) {
  await connection();
  const session = await prisma.eventSession.findFirst({
    where: { id: (await params).sessionId, cancelledAt: null, event: { status: "PUBLISHED", mode: "TICKETING" } },
    select: { id: true, event: { select: { title: true } } },
  });
  if (!session) notFound();

  return (
    <main className="mx-auto flex min-h-[75vh] w-full max-w-lg flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" style={{ animation: "marquee-blink 1.2s ease-in-out infinite" }} />
      <div>
        <p className="eyebrow mb-1">Sala de espera</p>
        <h1 className="font-display text-2xl">{session.event.title}</h1>
        <p className="mt-2 text-[var(--ink-muted)]">
          Hay mucha demanda para esta función. Deja esta página abierta: te llevamos a comprar automáticamente cuando
          sea tu turno, en el orden en que llegaste.
        </p>
      </div>
      <WaitingRoom sessionId={session.id} />
    </main>
  );
}
