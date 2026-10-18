import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime, formatMoney } from "@ticketera/core";
import { getTableStates, prisma, type TableLiveStatus } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { ROLES, can, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Mesas" };

type Props = { params: Promise<{ sessionId: string }> };

const STATUS: Record<TableLiveStatus, { text: string; card: string; badge: string }> = {
  FREE: { text: "Libre", card: "border-[var(--border)]", badge: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
  SOLD: { text: "Vendida", card: "border-[var(--warn)]/50 bg-[var(--warn-soft)]", badge: "bg-[var(--warn)] text-white" },
  OCCUPIED: { text: "Ocupada", card: "border-[var(--accent)]/60 bg-[var(--accent-soft)]", badge: "bg-[var(--accent)] text-white" },
};

/** Para anfitriones: cada mesa con su estado (libre, vendida, ocupada), quién la compró, cuántos entraron y su consumo. */
export default async function TablesPage({ params }: Props) {
  await connection();
  const staff = await requireStaff([...ROLES.manage, ...ROLES.pos]);
  const { sessionId } = await params;
  const session = await prisma.eventSession.findFirst({
    where: { id: sessionId, event: { organizationId: staff.organization.id } },
    select: { id: true, eventId: true, startsAt: true, event: { select: { title: true } }, venue: { select: { name: true, timezone: true } } },
  });
  if (!session) notFound();
  const groups = await getTableStates(session.id);
  const all = groups.flatMap((g) => g.tables);
  const count = (s: TableLiveStatus) => all.filter((t) => t.status === s).length;
  // Los anfitriones (cuentas de caja) vuelven a la boletería; quien administra, a la función.
  const back = can(staff, ROLES.manage) ? `/eventos/${session.eventId}/funciones/${session.id}` : `/boleteria/${session.id}`;

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={10} />
      <div>
        <Link href={back} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← {session.event.title}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Mesas</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name} · se actualiza cada 10 segundos
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--ink-muted)]">Esta función no tiene mesas, lounges ni reservados.</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-3 text-sm">
            {(["FREE", "SOLD", "OCCUPIED"] as const).map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className={`badge ${STATUS[s].badge}`}>{STATUS[s].text}</span>
                <span className="font-mono">{s === "FREE" ? groups.reduce((n, g) => n + g.freeCount, 0) : count(s)}</span>
              </li>
            ))}
          </ul>
          {groups.map((g) => (
            <section key={g.key} className="space-y-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <span className="h-3 w-3 rounded-full" style={{ background: g.color }} />
                {g.name}
                <span className="text-sm font-normal text-[var(--ink-muted)]">· {g.freeCount} libre(s)</span>
              </h2>
              {g.tables.length === 0 ? (
                <p className="text-sm text-[var(--ink-muted)]">Todavía no se vendió ninguna.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {g.tables.map((t) => (
                    <li key={t.key} className={`card space-y-1 border-2 p-3 ${STATUS[t.status].card}`}>
                      <div className="flex items-center justify-between gap-2">
                        <strong>{t.name}</strong>
                        <span className={`badge ${STATUS[t.status].badge}`}>{STATUS[t.status].text}</span>
                      </div>
                      {t.held && <p className="text-xs font-medium text-[#7c3aed]">Apartada: {t.held}</p>}
                      {t.chairs && (
                        <p className="text-xs text-[var(--ink-muted)]">
                          {t.chairs.sold} de {t.chairs.total} sillas vendidas
                        </p>
                      )}
                      {t.status !== "FREE" && (
                        <>
                          <p className="text-xs">
                            Entraron <strong>{t.entered}</strong> de {t.people}
                            {t.inside !== t.entered && ` · adentro ${t.inside}`}
                          </p>
                          {t.buyer && <p className="truncate text-xs text-[var(--ink-muted)]">{t.buyer}</p>}
                          {t.consumption && <p className="text-xs">Consumo: {formatMoney(t.consumption.left, t.consumption.currency)}</p>}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
