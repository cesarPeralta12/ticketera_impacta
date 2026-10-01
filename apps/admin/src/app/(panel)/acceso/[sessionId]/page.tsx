import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatCode, formatDateTime, formatTime } from "@ticketera/core";
import { getAccessStats, prisma, type ScanResult } from "@ticketera/db";
import { ROLES, requireStaff } from "@/lib/session";
import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Validar entradas" };

type Props = { params: Promise<{ sessionId: string }> };

const resultLabel: Record<ScanResult, string> = {
  ACCEPTED: "Aceptada",
  ALREADY_USED: "Ya usada",
  NOT_FOUND: "No existe",
  CANCELLED: "Anulada",
  WRONG_SESSION: "Otra función",
  INVALID: "Inválida",
};

export default async function AccessSessionPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.access);
  const session = await prisma.eventSession.findFirst({
    where: { id: (await params).sessionId, event: { organizationId: staff.organization.id } },
    include: { event: true, venue: { include: { accessPoints: { orderBy: { name: "asc" } } } } },
  });
  if (!session) notFound();

  const stats = await getAccessStats(session.id);
  const tz = session.venue.timezone;
  const pct = stats.issued ? Math.round((stats.used / stats.issued) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/acceso" className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]">
          ← Funciones
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{session.event.title}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {formatDateTime(session.startsAt, tz)} · {session.venue.name}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Scanner
          sessionId={session.id}
          timezone={tz}
          accessPoints={session.venue.accessPoints.map((p) => ({ id: p.id, name: p.name }))}
        />

        <div className="space-y-4">
          <div className="card p-5">
            <p className="text-xs text-[var(--ink-muted)]">Ingresados</p>
            <p className="text-3xl font-semibold tabular-nums">
              {stats.used} <span className="text-lg text-[var(--ink-dim)]">/ {stats.issued}</span>
            </p>
            <div className="mt-2 h-2 rounded bg-[var(--surface-2)]">
              <div className="h-2 rounded bg-[var(--accent)]" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="card">
            <h2 className="border-b border-[var(--border)] px-5 py-3 text-sm font-semibold">Últimas lecturas</h2>
            {stats.recent.length === 0 ? (
              <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">Sin lecturas todavía.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)] text-sm">
                {stats.recent.map((scan) => (
                  <li key={scan.id} className="flex justify-between gap-2 px-5 py-2">
                    <span>
                      <span className={scan.result === "ACCEPTED" ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                        {resultLabel[scan.result]}
                      </span>
                      <span className="block font-mono text-xs text-[var(--ink-muted)]">
                        {scan.ticket ? formatCode(scan.ticket.code) : scan.rawCode.slice(0, 16)}
                      </span>
                    </span>
                    <span className="text-right text-xs text-[var(--ink-muted)]">
                      {formatTime(scan.scannedAt, tz)}
                      <span className="block">{scan.accessPoint?.name}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
