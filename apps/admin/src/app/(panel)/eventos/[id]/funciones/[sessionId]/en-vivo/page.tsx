import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime } from "@ticketera/core";
import { getLiveAccess, prisma } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { LiveAccessBoard } from "@/components/live-access";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ingreso en vivo" };

type Props = { params: Promise<{ id: string; sessionId: string }> };

/** Vista del administrador: quién va entrando, en el mapa del recinto y en la lista de cada zona. */
export default async function LiveAccessPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id, sessionId } = await params;
  const owned = await prisma.eventSession.findFirst({
    where: { id: sessionId, eventId: id, event: { organizationId: staff.organization.id } },
    select: { id: true },
  });
  if (!owned) notFound();
  const data = (await getLiveAccess(sessionId))!;

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={5} />
      <div>
        <Link href={`/eventos/${id}/funciones/${sessionId}`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Función
        </Link>
        <h1 className="page-title mt-1">Ingreso en vivo · {data.session.title}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {formatDateTime(new Date(data.session.startsAt), data.session.timezone)} · {data.session.venue} · se actualiza cada 5 segundos con lo que
          suben los teléfonos de las puertas
        </p>
      </div>
      <LiveAccessBoard data={data} />
    </div>
  );
}
