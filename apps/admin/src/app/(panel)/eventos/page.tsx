import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CATEGORY_COLOR, CATEGORY_LABEL, formatDateTime, sellableCapacity } from "@ticketera/core";
import { EventCategory, EventStatus, prisma } from "@ticketera/db";
import { FilterForm } from "@/components/filter-form";
import { PAGE_SIZE, Pager, pageFrom } from "@/components/pager";
import { EVENT_STATUS } from "@/lib/labels";
import { enterOrganizationAction } from "@/lib/actions/platform";
import { ROLES, isGlobalView, isNightlife, requireStaff } from "@/lib/session";
import { Help } from "@/components/help";
import { CreateEventCta } from "@/components/create-event-cta";

export const metadata: Metadata = { title: "Eventos" };

type Props = { searchParams: Promise<{ q?: string; estado?: string; tipo?: string; desde?: string; hasta?: string; org?: string; pagina?: string; propios?: string }> };

export default async function EventsPage({ searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = Object.values(EventStatus).find((s) => s === sp.estado);
  const category = Object.values(EventCategory).find((c) => c === sp.tipo);
  // Fechas escritas en la hora de Bolivia (UTC-4): una función entra si cae entre «desde» y «hasta».
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.desde ?? "") ? new Date(`${sp.desde}T00:00:00-04:00`) : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.hasta ?? "") ? new Date(`${sp.hasta}T23:59:59-04:00`) : null;
  const filters = {
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(from || to ? { sessions: { some: { cancelledAt: null, startsAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } } : {}),
  };
  const filtered = Boolean(q || status || category || from || to || sp.org);
  const organizations = isGlobalView(staff) ? await prisma.organization.findMany({ where: { isPlatform: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];

  const ownWhere = { organizationId: staff.organization.id, ...filters, ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}) };
  const ownTotal = await prisma.event.count({ where: ownWhere });
  const ownPage = pageFrom(sp.propios, Math.ceil(ownTotal / PAGE_SIZE));
  const events = await prisma.event.findMany({
    where: ownWhere,
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    skip: (ownPage - 1) * PAGE_SIZE,
    include: {
      sessions: {
        where: { cancelledAt: null },
        orderBy: { startsAt: "asc" },
        include: {
          venue: { select: { name: true, timezone: true } },
          ticketTypes: { select: { capacity: true, sectionId: true, peoplePerUnit: true, section: { select: { capacity: true, seatingMode: true } } } },
          _count: { select: { tickets: { where: { status: { in: ["VALID", "USED"] } } } } },
        },
      },
    },
  });
  // Impacta ve también los eventos de todos los organizadores (para abrirlos, entra en el organizador).
  const othersWhere = {
    organizationId: sp.org ? sp.org : { not: staff.organization.id },
    ...filters,
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { organization: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const othersTotal = isGlobalView(staff) ? await prisma.event.count({ where: othersWhere }) : 0;
  const page = pageFrom(sp.pagina, Math.ceil(othersTotal / PAGE_SIZE));
  const others = isGlobalView(staff)
    ? await prisma.event.findMany({
        where: othersWhere,
        orderBy: [{ organization: { name: "asc" } }, { createdAt: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          organization: { select: { id: true, name: true } },
          sessions: {
            where: { cancelledAt: null },
            orderBy: { startsAt: "asc" },
            take: 1,
            include: { venue: { select: { name: true, timezone: true } } },
          },
        },
      })
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">
            {ownTotal} {isNightlife(staff) ? "noche(s)" : "evento(s)"}
          </p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {isGlobalView(staff) ? "Eventos de iPass" : isNightlife(staff) ? "Noches" : "Eventos"}
            {isNightlife(staff) ? (
              <Help title="Cómo se arma una noche">
                «+ Crear noche» abre el asistente: nombre, el día y la hora, las entradas y mesas (con modelos General, VIP, Mesa y
                Free), revisar y publicar. Una vez armada, se repite cada semana con «Repetir noches» o «Nueva noche».
              </Help>
            ) : (
              <Help title="Cómo se arma un evento">
                «+ Nuevo evento» abre el asistente: datos, lugar y fecha, entradas (con modelos General, VIP, Mesa, Free y
                Preventa), revisar con la vista previa del comprador y publicar. Para un evento chico, «+ Evento pequeño» es el acceso
                rápido: una sola pantalla, y se vende en la web («Otros eventos») o con entradas impresas.
              </Help>
            )}
          </h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!staff.readOnly && !isNightlife(staff) && (
            <Link href="/eventos/rapido" data-tour="evento-pequeno" className="btn" title="Acceso rápido para un evento chico: una sola pantalla, en la web o con entradas impresas">
              + Evento pequeño
            </Link>
          )}
          <CreateEventCta staff={staff} />
        </div>
      </div>

      <FilterForm key={JSON.stringify(sp)}>
        <label className="label grow basis-56">
          Buscar
          <input type="search" name="q" defaultValue={q} placeholder={isGlobalView(staff) ? "Nombre del evento u organizador" : "Nombre del evento"} className="field" autoComplete="off" />
        </label>
        <label className="label">
          Estado
          <select name="estado" defaultValue={status ?? ""} className="field">
            <option value="">Todos</option>
            {Object.values(EventStatus).map((s) => (
              <option key={s} value={s}>
                {EVENT_STATUS[s].text}
              </option>
            ))}
          </select>
        </label>
        {!isNightlife(staff) && (
          <label className="label">
            Tipo
            <select name="tipo" defaultValue={category ?? ""} className="field">
              <option value="">Todos</option>
              {Object.values(EventCategory).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        )}
        {organizations.length > 0 && (
          <label className="label">
            Organizador
            <select name="org" defaultValue={sp.org ?? ""} className="field max-w-52">
              <option value="">Todos</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="label">
          Desde
          <input type="date" name="desde" defaultValue={sp.desde ?? ""} className="field" />
        </label>
        <label className="label">
          Hasta
          <input type="date" name="hasta" defaultValue={sp.hasta ?? ""} className="field" />
        </label>
      </FilterForm>

      {events.length === 0 && filtered ? (
        <p className="card p-6 text-center text-[var(--ink-muted)]">Ningún evento propio coincide con la búsqueda.</p>
      ) : events.length === 0 ? (
        <div className="card border-dashed p-8 text-center">
          <p className="font-medium">{isNightlife(staff) ? "Todavía no hay noches." : "Todavía no hay eventos."}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--ink-muted)]">
            {isNightlife(staff)
              ? "Se arma una vez: el boliche con su plano (Recintos), una noche con sus precios, y después se repite cada semana."
              : "El orden es: el recinto (una sola vez), el evento, sus fechas con precios y publicar."}
          </p>
          {!staff.readOnly && (
            <Link href="/eventos/nuevo" className="btn btn-primary mt-4 inline-flex">
              {isNightlife(staff) ? "Crear la primera noche" : "Crear el primer evento"}
            </Link>
          )}
        </div>
      ) : (
        <ul data-tour="lista-eventos" className="flex flex-col gap-2.5">
          {events.map((event) => {
            const [first] = event.sessions;
            const capacity = event.sessions.reduce((sum, s) => sum + sellableCapacity(s.ticketTypes), 0);
            const sold = event.sessions.reduce((sum, s) => sum + s._count.tickets, 0);
            const status = EVENT_STATUS[event.status];
            const color = CATEGORY_COLOR[event.category] ?? CATEGORY_COLOR.OTRO;
            const percent = capacity > 0 ? Math.min(100, Math.round((sold / capacity) * 100)) : 0;
            return (
              <li key={event.id}>
                <Link
                  href={`/eventos/${event.id}`}
                  style={{ borderLeft: `4px solid ${color}` }}
                  className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                >
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-medium">{event.title}</span>
                      <span className={`badge ${status.className}`}>{status.text}</span>
                      {event.small && <span className="badge badge-highlight">Pequeño</span>}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm text-[var(--ink-muted)]">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                      {CATEGORY_LABEL[event.category]}
                      {first && ` · ${first.venue.name}`}
                    </p>
                  </div>
                  <div className="text-right font-mono text-xs text-[var(--ink-dim)]">
                    <p>
                      {event.sessions.length === 0
                        ? "sin funciones"
                        : `${event.sessions.length} función(es) · ${formatDateTime(first!.startsAt, first!.venue.timezone)}`}
                    </p>
                    <p>
                      {sold} / {capacity} vendidas
                    </p>
                    {capacity > 0 && (
                      <span className="ml-auto mt-1.5 block h-1.5 w-32 overflow-hidden rounded-full bg-[var(--surface-2)]" aria-hidden>
                        <span className="block h-full rounded-full" style={{ width: `${percent}%`, background: "var(--grad-brand)" }} />
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Pager path="/eventos" param="propios" params={{ q, estado: status, tipo: category, desde: sp.desde, hasta: sp.hasta, org: sp.org, pagina: sp.pagina }} page={ownPage} total={ownTotal} />

      {isGlobalView(staff) && (
        <section className="space-y-2">
          <h2 className="eyebrow">De los organizadores ({othersTotal})</h2>
          {others.length === 0 ? (
            <p className="card p-5 text-sm text-[var(--ink-muted)]">{filtered ? "Ningún evento de los organizadores coincide con la búsqueda." : "Los organizadores todavía no cargaron eventos."}</p>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-[var(--border)]">
                  {others.map((event) => {
                    const first = event.sessions[0];
                    const status = EVENT_STATUS[event.status];
                    return (
                      <tr key={event.id}>
                        <td className="px-5 py-3">
                          <p className="font-medium">{event.title}</p>
                          <p className="text-xs text-[var(--ink-dim)]">
                            {event.organization.name}
                            {first && ` · ${formatDateTime(first.startsAt, first.venue.timezone)} · ${first.venue.name}`}
                          </p>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`badge ${status.className}`}>{status.text}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <form action={enterOrganizationAction}>
                            <input type="hidden" name="organizationId" value={event.organization.id} />
                            <input type="hidden" name="next" value={`/eventos/${event.id}`} />
                            <button type="submit" className="btn text-xs">
                              Abrir
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pager path="/eventos" params={{ q, estado: status, tipo: category, desde: sp.desde, hasta: sp.hasta, org: sp.org, propios: sp.propios }} page={page} total={othersTotal} />
        </section>
      )}
    </div>
  );
}
