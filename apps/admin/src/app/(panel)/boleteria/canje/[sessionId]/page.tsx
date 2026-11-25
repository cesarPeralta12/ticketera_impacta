import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime } from "@ticketera/core";
import { canRedeemSession, prisma } from "@ticketera/db";
import { ROLES, requireStaff } from "@/lib/session";
import { RedeemTerminal } from "./redeem-terminal";

export const metadata: Metadata = { title: "Canje por tarjeta NFC" };

type Props = { params: Promise<{ sessionId: string }> };

export default async function RedeemPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.pos);
  const session = await prisma.eventSession.findFirst({
    where: { id: (await params).sessionId, cancelledAt: null, event: { organizationId: staff.organization.id } },
    include: { event: { select: { title: true } }, venue: { select: { name: true, timezone: true } } },
  });
  if (!session) notFound();
  const allowed = !staff.readOnly && (await canRedeemSession({ id: staff.id, role: staff.role, organizationId: staff.organization.id }, session.id));

  return (
    <div className="space-y-6">
      <div>
        {/* Carga completa: el permiso de cámara es solo de esta pantalla (ver next.config.ts). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/boleteria" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Boletería
        </a>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Canjea tu entrada por un NFC</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {session.event.title} · {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name}
        </p>
      </div>

      {allowed ? (
        <RedeemTerminal sessionId={session.id} />
      ) : (
        <p className="card p-5 text-sm text-[var(--ink-muted)]">
          Tu cuenta no puede canjear en esta función. Un administrador puede habilitarlo en Usuarios → tu cuenta → «Tarjetas y manillas NFC».
        </p>
      )}
    </div>
  );
}
