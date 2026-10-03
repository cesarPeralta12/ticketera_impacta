import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, formatDateTime } from "@ticketera/core";
import { getEventReport } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { EventReport } from "@/components/event-report";
import { PrintButton } from "@/components/print-button";
import { MODE_LABEL } from "@/lib/labels";
import { ROLES, requireStaff, visibleEvent } from "@/lib/session";

export const metadata: Metadata = { title: "Mi evento" };

type Props = { params: Promise<{ eventId: string }> };

export default async function ClientEventPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.client);
  const event = await visibleEvent(staff, (await params).eventId);
  if (!event) notFound();
  const report = (await getEventReport(event.id))!;
  const tz = report.sessions[0]?.venue.timezone ?? DEFAULT_TIMEZONE;

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/cliente" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)] print:hidden">
            ← Mis eventos
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{event.title}</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {MODE_LABEL[event.mode]} · se actualiza cada 30 segundos
            {event.clientAccessUntil && ` · tu acceso se cierra el ${formatDateTime(event.clientAccessUntil, tz)}`}
          </p>
        </div>
        <PrintButton />
      </div>

      {event.mode === "GUEST_LIST" && (
        <section className="card p-5 print:hidden">
          <h2 className="eyebrow mb-3">Lista de invitados</h2>
          <ul className="flex flex-col gap-2">
            {report.sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/cliente/${event.id}/invitados/${s.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-4 py-3 text-sm hover:border-[var(--accent)]"
                >
                  <span>
                    <span className="font-mono">{formatDateTime(s.startsAt, s.venue.timezone)}</span>
                    <span className="text-[var(--ink-muted)]"> · {s.venue.name}</span>
                  </span>
                  <span className="text-[var(--accent)]">{s.issued} invitado(s) · cargar o ver →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EventReport report={report} csvHref={`/cliente/${event.id}/csv`} />
    </div>
  );
}
