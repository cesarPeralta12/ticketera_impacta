import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatClock, formatDateTime } from "@ticketera/core";
import { getLiveAccess, getOfflineConflicts, getZoneOccupancy, prisma } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { LiveAccessBoard } from "@/components/live-access";
import { SCAN_LABEL } from "@/lib/labels";
import { ROLES, eventScope, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ingreso en vivo" };

type Props = { params: Promise<{ id: string; sessionId: string }> };

/** Vista del administrador: quién va entrando, en el mapa del recinto y en la lista de cada zona. */
export default async function LiveAccessPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id, sessionId } = await params;
  const owned = await prisma.eventSession.findFirst({
    // Impacta en vista general también abre los eventos de los organizadores (eventScope).
    where: { id: sessionId, eventId: id, event: eventScope(staff) },
    select: { id: true },
  });
  if (!owned) notFound();
  const [data, occupancy, conflicts] = await Promise.all([getLiveAccess(sessionId), getZoneOccupancy(sessionId), getOfflineConflicts(sessionId)]);
  if (!data || !occupancy) notFound();
  const tz = data.session.timezone;
  // Solo si el recinto tiene zonas o hubo salidas: si no, el tablero de siempre ya lo dice todo.
  const showPresence = occupancy.zones.length > 0 || occupancy.exited > 0 || occupancy.reentries > 0;

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
      {showPresence && (
        <section className="card space-y-4 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="eyebrow">Adentro ahora</h2>
            <p className="font-mono text-sm text-[var(--ink-muted)]">
              <strong className="text-[var(--ink)]">{occupancy.inside}</strong> adentro · {occupancy.entered} entraron · {occupancy.exited} salieron
              {occupancy.reentries > 0 && ` · ${occupancy.reentries} reingresos`}
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...occupancy.zones, ...(occupancy.general > 0 || occupancy.zones.length === 0 ? [{ id: "general", name: "Ingreso general (sin zona)", color: "#8a8f98", capacity: null, inside: occupancy.general }] : [])].map((z) => {
              const pct = z.capacity ? Math.min(100, Math.round((z.inside / z.capacity) * 100)) : null;
              const full = z.capacity !== null && z.inside >= z.capacity;
              return (
                <li key={z.id} className="rounded-md border border-[var(--border)] p-4">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="h-3 w-3 rounded-full" style={{ background: z.color }} />
                    {z.name}
                  </p>
                  <p className="mt-1 font-mono text-2xl">
                    {z.inside}
                    {z.capacity !== null && <span className="text-sm text-[var(--ink-dim)]"> / {z.capacity}</span>}
                  </p>
                  {pct !== null && (
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: full ? "var(--danger)" : z.color }} />
                    </div>
                  )}
                  {full && <p className="mt-1 text-xs font-semibold text-[var(--danger)]">Zona llena</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <LiveAccessBoard data={data} />
      {conflicts.length > 0 && (
        <section className="card space-y-3 p-6">
          <div>
            <h2 className="eyebrow text-[var(--warn)]">Lecturas sin conexión con conflicto ({conflicts.length})</h2>
            <p className="text-sm text-[var(--ink-muted)]">
              Un teléfono sin internet dejó pasar (o rechazó) una entrada y, al sincronizar, ya figuraba usada, anulada o no
              existía. Revísalas: pueden ser dobles ingresos o entradas falsas.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-[var(--ink-dim)]">
                <tr>
                  <th className="py-1 font-normal">Hora</th>
                  <th className="py-1 font-normal">Resultado</th>
                  <th className="py-1 font-normal">Entrada</th>
                  <th className="py-1 font-normal">Puerta</th>
                  <th className="py-1 font-normal">Portero</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {conflicts.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 font-mono">{formatClock(c.scannedAt, tz)}</td>
                    <td className="py-1.5">{SCAN_LABEL[c.result]}</td>
                    <td className="py-1.5">
                      {c.ticket ? (
                        <Link href={`/entradas/${c.ticket.code}`} className="text-[var(--accent)] hover:underline">
                          {c.ticket.holderName ?? c.ticket.code}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">{c.rawCode.slice(0, 24)}</span>
                      )}
                    </td>
                    <td className="py-1.5">{c.accessPoint?.name ?? "—"}</td>
                    <td className="py-1.5">{c.operator?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
