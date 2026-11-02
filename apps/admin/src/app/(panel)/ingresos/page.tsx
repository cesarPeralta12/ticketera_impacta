import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatCode, formatDateTime, isPastNight } from "@ticketera/core";
import { prisma, type Prisma } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { startOfToday } from "@/lib/dates";
import { MOVEMENT_LABEL, SCAN_LABEL } from "@/lib/labels";
import { PAGE_SIZE, Pager, pageFrom } from "@/components/pager";
import { ROLES, eventScope, isGlobalView, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ingresos en puerta" };

type Props = { searchParams: Promise<{ org?: string; solo?: string; pagina?: string; evento?: string; sesion?: string; ver?: string }> };

/** Cuántos eventos con funciones se muestran como tarjetas. */
const MAX_SESSIONS = 120;

/**
 * Entradas que se van registrando en las puertas, en vivo. IMPACTA (vista general) ve las de
 * todos los organizadores; un organizador, solo las de sus eventos.
 */
export default async function EntriesPage({ searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const global = isGlobalView(staff);
  const { org = "", solo = "", pagina, evento = "", sesion = "", ver = "" } = await searchParams;
  const past = ver === "pasadas";
  const now = new Date();
  const day = 24 * 60 * 60_000;

  const eventFilter: Prisma.EventWhereInput = global && org ? { organizationId: org } : eventScope(staff);
  const since = startOfToday();

  // Tarjetas: una por evento y, dentro, una fila por noche (función). Primero las de hoy y las que vienen; con «Pasadas», el último mes.
  const candidateSessions = await prisma.eventSession.findMany({
    where: {
      cancelledAt: null,
      event: eventScope(staff),
      startsAt: past ? { gte: new Date(now.getTime() - 30 * day), lte: now } : { gte: new Date(now.getTime() - 3 * day) },
    },
    orderBy: { startsAt: past ? "desc" : "asc" },
    take: MAX_SESSIONS * 2,
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      venue: { select: { name: true, timezone: true } },
      event: { select: { id: true, title: true, organization: { select: { id: true, name: true } } } },
    },
  });
  const sessions = candidateSessions.filter((s) => isPastNight(s.startsAt, s.endsAt, now) === past).slice(0, MAX_SESSIONS);
  // Los boliches (organizadores) que tienen noches en esta vista, para filtrar tocándolos.
  const boliches = [...new Map(sessions.map((s) => [s.event.organization.id, s.event.organization.name])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const shown = org && global ? sessions.filter((s) => s.event.organization.id === org) : sessions;
  const sessionIds = shown.map((s) => s.id);
  const [totals, entered, inside, rejected] = await Promise.all([
    prisma.ticket.groupBy({ by: ["sessionId"], where: { sessionId: { in: sessionIds }, status: { in: ["VALID", "USED"] } }, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["sessionId"], where: { sessionId: { in: sessionIds }, OR: [{ entries: { gt: 0 } }, { status: "USED" }] }, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["sessionId"], where: { sessionId: { in: sessionIds }, inside: true }, _count: { _all: true } }),
    prisma.accessScan.groupBy({
      by: ["sessionId"],
      where: { sessionId: { in: sessionIds }, result: { not: "ACCEPTED" }, scannedAt: { gte: past ? new Date(0) : since } },
      _count: { _all: true },
    }),
  ]);
  const countOf = (rows: { sessionId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.sessionId, r._count._all]));
  const totalBy = countOf(totals);
  const enteredBy = countOf(entered);
  const insideBy = countOf(inside);
  const rejectedBy = countOf(rejected);
  const byEvent = new Map<string, { id: string; title: string; org: string; sessions: typeof shown }>();
  for (const s of shown) {
    const group = byEvent.get(s.event.id) ?? { id: s.event.id, title: s.event.title, org: s.event.organization.name, sessions: [] };
    group.sessions.push(s);
    byEvent.set(s.event.id, group);
  }

  // La lista de lecturas sigue lo elegido: una noche, un evento o todo lo que se ve.
  const scope: Prisma.AccessScanWhereInput = {
    session: { event: eventFilter, ...(sesion ? { id: sesion } : evento ? { eventId: evento } : {}) },
  };
  const listWhere = { ...scope, ...(solo === "rechazos" ? { result: { not: "ACCEPTED" as const } } : {}) };
  const total = await prisma.accessScan.count({ where: listWhere });
  const page = pageFrom(pagina, Math.ceil(total / PAGE_SIZE));
  const [scans, acceptedToday, rejectedToday, organizers] = await Promise.all([
    prisma.accessScan.findMany({
      where: listWhere,
      orderBy: { scannedAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: {
        ticket: {
          select: {
            code: true,
            holderName: true,
            ticketType: { select: { name: true } },
            seat: { select: { label: true } },
            order: { select: { buyerName: true } },
          },
        },
        session: {
          select: {
            id: true,
            startsAt: true,
            event: { select: { id: true, title: true, organization: { select: { name: true } } } },
            venue: { select: { timezone: true } },
          },
        },
        accessPoint: { select: { name: true } },
        operator: { select: { name: true } },
      },
    }),
    prisma.accessScan.count({
      where: { ...scope, result: "ACCEPTED", scannedAt: { gte: since }, OR: [{ movement: null }, { movement: { in: ["ENTRY", "REENTRY"] } }] },
    }),
    prisma.accessScan.count({ where: { ...scope, result: { not: "ACCEPTED" }, scannedAt: { gte: since } } }),
    global ? prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const href = (params: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries({ org, ver, ...params }).filter(([, v]) => v) as [string, string][]).toString();
    return q ? `/ingresos?${q}` : "/ingresos";
  };

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={15} />
      <div>
        <p className="eyebrow">{global ? "Todos los organizadores" : staff.organization.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Ingresos en puerta</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Cada lectura de QR en las puertas: quién entró, por dónde y con qué equipo, y los rechazos. Se actualiza
          cada 15 segundos.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4">
          <p className="eyebrow">Ingresaron hoy</p>
          <p className="mt-1 font-mono text-2xl text-[var(--accent)]">{acceptedToday}</p>
        </div>
        <div className="card p-4">
          <p className="eyebrow">Rechazos hoy</p>
          <p className="mt-1 font-mono text-2xl text-[var(--danger)]">{rejectedToday}</p>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ ver: "" })} className={past ? "btn text-xs" : "btn btn-primary text-xs"}>
            Hoy y próximas
          </Link>
          <Link href={href({ ver: "pasadas" })} className={past ? "btn btn-primary text-xs" : "btn text-xs"}>
            Pasadas (último mes)
          </Link>
          {global && boliches.length > 1 && (
            <span className="ml-2 flex flex-wrap items-center gap-1.5">
              <span className="eyebrow">Boliche</span>
              <Link href={href({ org: "" })} className={`badge ${org ? "" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>
                Todos
              </Link>
              {boliches.map((b) => (
                <Link key={b.id} href={href({ org: b.id })} className={`badge ${org === b.id ? "bg-[var(--accent-soft)] text-[var(--accent)]" : ""}`}>
                  {b.name}
                </Link>
              ))}
            </span>
          )}
        </div>

        {byEvent.size === 0 ? (
          <p className="card p-4 text-sm text-[var(--ink-muted)]">{past ? "No hubo noches en el último mes." : "No hay noches de hoy ni próximas."}</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {[...byEvent.values()].map((group) => (
              <div key={group.id} className={`card space-y-2 p-4 ${evento === group.id && !sesion ? "ring-1 ring-[var(--accent)]" : ""}`}>
                <div>
                  <Link href={href({ evento: group.id })} className="font-medium text-[var(--accent)] hover:underline" title="Ver solo las lecturas de este evento">
                    {group.title}
                  </Link>
                  {global && <p className="text-xs font-medium text-[var(--ink-muted)]">{group.org}</p>}
                </div>
                <ul className="divide-y divide-[var(--border)]">
                  {group.sessions.map((s) => {
                    const total = totalBy.get(s.id) ?? 0;
                    const done = enteredBy.get(s.id) ?? 0;
                    const pct = total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100));
                    const rej = rejectedBy.get(s.id) ?? 0;
                    return (
                      <li key={s.id} className={`py-2 ${sesion === s.id ? "rounded bg-[var(--accent-soft)] px-2" : ""}`}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <Link href={href({ sesion: s.id })} className="text-sm hover:underline" title="Ver solo las lecturas de esta noche">
                            {formatDateTime(s.startsAt, s.venue.timezone)} · <span className="text-[var(--ink-muted)]">{s.venue.name}</span>
                          </Link>
                          <Link
                            href={`/eventos/${s.event.id}/funciones/${s.id}/en-vivo`}
                            className="text-xs text-[var(--ink-dim)] hover:text-[var(--ink)]"
                            title="Mapa y lista de ingreso en vivo"
                          >
                            En vivo →
                          </Link>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                          <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">
                          <span className="font-mono text-[var(--ink)]">{done}</span> de <span className="font-mono">{total}</span> ingresaron ({pct}%) ·{" "}
                          <span className="font-mono">{insideBy.get(s.id) ?? 0}</span> adentro
                          {rej > 0 && (
                            <>
                              {" "}
                              · <span className="text-[var(--danger)]">{rej} rechazo{rej === 1 ? "" : "s"}{past ? "" : " hoy"}</span>
                            </>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {(evento || sesion) && (
          <p className="text-sm text-[var(--ink-muted)]">
            Las lecturas de abajo son solo de {sesion ? "la noche elegida" : "este evento"}.{" "}
            <Link href={href({})} className="text-[var(--accent)] hover:underline">
              Ver todas
            </Link>
          </p>
        )}
      </section>

      <form data-tour="filtros-ingresos" className="card flex flex-wrap items-end gap-3 p-4">
        {evento && <input type="hidden" name="evento" value={evento} />}
        {sesion && <input type="hidden" name="sesion" value={sesion} />}
        {past && <input type="hidden" name="ver" value="pasadas" />}
        <label className="label">
          Mostrar
          <select name="solo" defaultValue={solo} className="field">
            <option value="">Todas las lecturas</option>
            <option value="rechazos">Solo rechazos</option>
          </select>
        </label>
        {global && (
          <label className="label">
            Organizador
            <select name="org" defaultValue={org} className="field">
              <option value="">Todos</option>
              {organizers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="btn">
          Filtrar
        </button>
        {(org || solo) && (
          <Link href="/ingresos" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
            Limpiar
          </Link>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="table-cards w-full text-left text-sm">
          <thead className="eyebrow border-b border-[var(--border)]">
            <tr>
              <th className="px-4 py-3 font-normal">Hora</th>
              <th className="px-4 py-3 font-normal">Persona</th>
              <th className="px-4 py-3 font-normal">Evento</th>
              <th className="px-4 py-3 font-normal">Puerta · equipo</th>
              <th className="px-4 py-3 font-normal">Resultado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {scans.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--ink-muted)]">
                  Todavía no hay lecturas en puerta.
                </td>
              </tr>
            )}
            {scans.map((s) => {
              const tz = s.session.venue.timezone;
              return (
                <tr key={s.id} className="align-top">
                  <td data-label="Hora" className="px-4 py-2.5 font-mono text-xs">
                    {formatDateTime(s.scannedAt, tz)}
                    {s.offline && <span className="block text-[var(--warn)]">sin conexión</span>}
                  </td>
                  <td data-label="Persona" className="px-4 py-2.5">
                    {s.ticket ? (
                      <>
                        <p>{s.ticket.holderName ?? s.ticket.order.buyerName}</p>
                        <p className="text-xs text-[var(--ink-dim)]">
                          {s.ticket.ticketType.name}
                          {s.ticket.seat ? ` · ${s.ticket.seat.label}` : ""} · {formatCode(s.ticket.code)}
                        </p>
                      </>
                    ) : (
                      <p className="text-[var(--ink-dim)]">QR no reconocido</p>
                    )}
                  </td>
                  <td data-label="Evento" className="px-4 py-2.5">
                    <p>
                      <Link
                        href={`/eventos/${s.session.event.id}/funciones/${s.session.id}/en-vivo`}
                        className="text-[var(--accent)] hover:underline"
                        title="Ver el mapa y la lista de ingreso de esta función"
                      >
                        {s.session.event.title}
                      </Link>
                    </p>
                    {global && <p className="text-xs font-medium text-[var(--ink-muted)]">{s.session.event.organization.name}</p>}
                  </td>
                  <td data-label="Puerta" className="px-4 py-2.5 text-xs text-[var(--ink-muted)]">
                    {s.accessPoint?.name ?? "Sin puerta"}
                    {s.deviceId && <span className="block">{s.deviceId}</span>}
                    {s.operator && <span className="block">{s.operator.name}</span>}
                  </td>
                  <td data-label="Resultado" className="px-4 py-2.5">
                    <span
                      className={`badge ${s.result === "ACCEPTED" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}
                    >
                      {s.result === "ACCEPTED" && s.movement && s.movement !== "ENTRY" ? MOVEMENT_LABEL[s.movement] : SCAN_LABEL[s.result]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager path="/ingresos" params={{ org, solo, evento, sesion, ver }} page={page} total={total} />
    </div>
  );
}
