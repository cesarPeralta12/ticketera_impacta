import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime } from "@ticketera/core";
import { getLiveAccess, prisma } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { LiveAccessBoard } from "@/components/live-access";
import { ROLES, requireStaff, visibleEvent } from "@/lib/session";

export const metadata: Metadata = { title: "Ingreso en vivo" };

type Props = { params: Promise<{ eventId: string; sessionId: string }> };

/** Vista del organizador: el mismo mapa y listas, solo de sus eventos. */
export default async function ClientLiveAccessPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.client);
  const { eventId, sessionId } = await params;
  const event = await visibleEvent(staff, eventId);
  if (!event) notFound();
  const owned = await prisma.eventSession.findFirst({ where: { id: sessionId, eventId: event.id }, select: { id: true } });
  if (!owned) notFound();
  const data = (await getLiveAccess(sessionId))!;

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={5} />
      <div>
        <Link href={`/cliente/${event.id}`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← {event.title}
        </Link>
        <h1 className="page-title mt-1">Ingreso en vivo</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {formatDateTime(new Date(data.session.startsAt), data.session.timezone)} · {data.session.venue} · se actualiza cada 5 segundos
        </p>
      </div>
      <LiveAccessBoard data={data} />
    </div>
  );
}
