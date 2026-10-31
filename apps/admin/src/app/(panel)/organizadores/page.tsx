import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatMoney } from "@ticketera/core";
import { MIN_PASSWORD_LENGTH, getEventQuota, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { FilterForm } from "@/components/filter-form";
import { ModalButton } from "@/components/modal";
import { PAGE_SIZE, Pager, pageFrom } from "@/components/pager";
import { createOrganizerAction, enterOrganizationAction, setSelfManagedAction } from "@/lib/actions/platform";
import { requirePlatform } from "@/lib/session";

export const metadata: Metadata = { title: "Organizadores" };

type Kind = "EVENTS" | "NIGHTLIFE";
const KIND_FROM_PARAM: Record<string, Kind> = { eventos: "EVENTS", boliche: "NIGHTLIFE" };

type Filters = { kind?: Kind; q: string; estado: string; edicion: string };

/** Organizadores de una página, con sus cifras: eventos por estado, entradas vendidas y lo recaudado. */
async function organizersWithStats(filters: Filters, requestedPage: string | undefined) {
  const where = {
    isPlatform: false,
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.estado === "activo" ? { status: "ACTIVE" as const } : filters.estado === "suspendido" ? { status: "SUSPENDED" as const } : {}),
    ...(filters.edicion === "edita" ? { selfManaged: true } : filters.edicion === "solo-ver" ? { selfManaged: false } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" as const } },
            { contactEmail: { contains: filters.q, mode: "insensitive" as const } },
            { taxId: { contains: filters.q, mode: "insensitive" as const } },
            { members: { some: { user: { email: { contains: filters.q, mode: "insensitive" as const } } } } },
          ],
        }
      : {}),
  };
  const total = await prisma.organization.count({ where });
  const page = pageFrom(requestedPage, Math.ceil(total / PAGE_SIZE));
  const organizations = await prisma.organization.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { _count: { select: { members: true, venues: true } } },
  });
  const rows = await Promise.all(
    organizations.map(async (org) => {
      const byOrg = { event: { organizationId: org.id } };
      const [events, tickets, revenue, quota] = await Promise.all([
        prisma.event.groupBy({ by: ["status"], where: { organizationId: org.id }, _count: true }),
        prisma.ticket.count({ where: { status: { in: ["VALID", "USED"] }, session: byOrg } }),
        prisma.order.aggregate({
          _sum: { totalAmount: true },
          where: { status: "PAID", items: { some: { ticketType: { session: byOrg } } } },
        }),
        getEventQuota(org.id),
      ]);
      const count = (status: string) => events.find((e) => e.status === status)?._count ?? 0;
      return {
        ...org,
        published: count("PUBLISHED"),
        pending: count("PENDING_REVIEW"),
        drafts: count("DRAFT"),
        quota,
        tickets,
        revenue: revenue._sum.totalAmount ?? 0,
      };
    }),
  );
  return { rows, total, page };
}

type Props = { searchParams: Promise<{ tipo?: string; q?: string; estado?: string; edicion?: string; pagina?: string }> };

export default async function OrganizersPage({ searchParams }: Props) {
  await connection();
  await requirePlatform();
  const sp = await searchParams;
  const filters: Filters = { kind: KIND_FROM_PARAM[sp.tipo ?? ""], q: (sp.q ?? "").trim(), estado: sp.estado ?? "", edicion: sp.edicion ?? "" };
  const { rows: organizers, total, page } = await organizersWithStats(filters, sp.pagina);
  const kind = filters.kind;
  const filtered = Boolean(filters.q || filters.estado || filters.edicion);
  const params = { tipo: sp.tipo, q: filters.q, estado: filters.estado, edicion: filters.edicion };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{total} organizador(es)</p>
          <h1 className="text-2xl font-semibold tracking-tight">{kind === "NIGHTLIFE" ? "Boliches" : kind === "EVENTS" ? "Organizadores de eventos" : "Organizadores"}</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-muted)]">
            Clientes a los que iPass les da el servicio: organizadores de eventos y boliches. Cada uno puede ser de <strong>solo lectura</strong> (ve en vivo sus
            eventos o noches, ventas e ingresos) o tener <strong>edición</strong> (crea y edita lo suyo, y lo que publica pasa por tu aprobación). Lo eliges al
            crearlo y lo puedes cambiar cuando quieras.
          </p>
        </div>
        <div data-tour="nuevo-organizador" className="flex flex-wrap justify-end gap-2">
          <ModalButton
            label="+ Crear boliche"
            title="Crear boliche"
            description="Discoteca, boliche o lounge: su panel muestra noches, mesas, consumo en barra, free por horario, ventas e ingresos."
            primary
          >
            <NewOrganizerForm kind="NIGHTLIFE" />
          </ModalButton>
          <ModalButton
            label="+ Crear organizador de eventos"
            title="Crear organizador de eventos"
            description="Productora de conciertos, teatro, festivales u otros eventos: su panel muestra sus eventos, ventas, compradores e ingresos."
          >
            <NewOrganizerForm kind="EVENTS" />
          </ModalButton>
        </div>
      </div>

      <FilterForm key={JSON.stringify(sp)}>
        <label className="label grow basis-56">
          Buscar
          <input type="search" name="q" defaultValue={filters.q} placeholder="Nombre, NIT o correo" className="field" autoComplete="off" />
        </label>
        <label className="label">
          Tipo
          <select name="tipo" defaultValue={sp.tipo ?? ""} className="field">
            <option value="">Todos</option>
            <option value="boliche">Boliches</option>
            <option value="eventos">Eventos</option>
          </select>
        </label>
        <label className="label">
          Permiso
          <select name="edicion" defaultValue={filters.edicion} className="field">
            <option value="">Todos</option>
            <option value="solo-ver">Solo ver</option>
            <option value="edita">Edita (con aprobación)</option>
          </select>
        </label>
        <label className="label">
          Estado
          <select name="estado" defaultValue={filters.estado} className="field">
            <option value="">Todos</option>
            <option value="activo">Activos</option>
            <option value="suspendido">Suspendidos</option>
          </select>
        </label>
      </FilterForm>

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="eyebrow border-b border-[var(--border)]">
            <tr>
              <th className="px-5 py-3 font-normal">Organizador</th>
              <th className="px-5 py-3 font-normal">Permiso</th>
              <th className="px-5 py-3 font-normal">Eventos</th>
              <th className="px-5 py-3 text-right font-normal">Entradas</th>
              <th className="px-5 py-3 text-right font-normal">Recaudado</th>
              <th className="px-5 py-3 font-normal">Estado</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {organizers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-6 text-center text-[var(--ink-muted)]">
                  {filtered ? "Ningún organizador coincide con la búsqueda." : kind === "NIGHTLIFE" ? "Todavía no hay boliches." : "Todavía no hay organizadores."}{" "}
                  {!filtered && "Crea el primero con el botón de arriba."}
                </td>
              </tr>
            )}
            {organizers.map((o) => (
              <tr key={o.id} className="align-top">
                <td className="px-5 py-3">
                  <Link href={`/organizadores/${o.id}`} className="font-medium hover:text-[var(--accent)]">
                    {o.name}
                  </Link>
                  <span
                    className={`badge ml-2 ${o.kind === "NIGHTLIFE" ? "bg-[var(--accent-soft)] text-[var(--accent-hover)]" : "bg-[var(--info-soft)] text-[var(--info)]"}`}
                  >
                    {o.kind === "NIGHTLIFE" ? "boliche" : "eventos"}
                  </span>
                  <p className="text-xs text-[var(--ink-dim)]">
                    {[o.taxId && `NIT ${o.taxId}`, o.contactEmail].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                  </p>
                  <p className="text-xs text-[var(--ink-dim)]">
                    {o._count.members} cuenta(s) · {o._count.venues} recinto(s)
                  </p>
                </td>
                <td className="px-5 py-3">
                  <span className={`badge ${o.selfManaged ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--surface-2)] text-[var(--ink-muted)]"}`}>
                    {o.selfManaged ? "Edita (con aprobación)" : "Solo ver"}
                  </span>
                  <ActionForm
                    action={setSelfManagedAction}
                    className="mt-1.5"
                    confirm={o.selfManaged ? `¿Pasar a ${o.name} a solo ver? Dejará de poder crear y editar.` : `¿Darle edición a ${o.name}? Lo que publique pasará por tu aprobación.`}
                  >
                    <input type="hidden" name="organizationId" value={o.id} />
                    <input type="hidden" name="selfManaged" value={o.selfManaged ? "false" : "true"} />
                    <button type="submit" className="text-xs text-[var(--accent)] hover:underline">
                      {o.selfManaged ? "Pasar a solo ver" : "Dar edición"}
                    </button>
                  </ActionForm>
                </td>
                <td className="px-5 py-3 text-xs">
                  <p>{o.published} publicado(s)</p>
                  <p className={o.quota.reached ? "font-medium text-[var(--warn)]" : "text-[var(--ink-dim)]"}>
                    {o.quota.used}
                    {o.quota.limit === null ? " activos · sin límite" : ` / ${o.quota.limit} activos`}
                  </p>
                  {o.pending > 0 && (
                    <Link href="/aprobaciones" className="font-medium text-[var(--warn)] hover:underline">
                      {o.pending} esperando aprobación
                    </Link>
                  )}
                  {o.drafts > 0 && <p className="text-[var(--ink-dim)]">{o.drafts} borrador(es)</p>}
                </td>
                <td className="px-5 py-3 text-right font-mono">{o.tickets}</td>
                <td className="px-5 py-3 text-right font-mono">{formatMoney(o.revenue, o.currency)}</td>
                <td className="px-5 py-3">
                  <span
                    className={`badge ${o.status === "ACTIVE" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}
                  >
                    {o.status === "ACTIVE" ? "Activo" : "Suspendido"}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-2">
                    <form action={enterOrganizationAction}>
                      <input type="hidden" name="organizationId" value={o.id} />
                      <input type="hidden" name="next" value="/" />
                      <button type="submit" className="btn text-xs">
                        Entrar
                      </button>
                    </form>
                    <Link href={`/organizadores/${o.id}`} className="btn text-xs">
                      Ver
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager path="/organizadores" params={params} page={page} total={total} />
    </div>
  );
}

/** Alta de un usuario de eventos o de boliche: organización nueva y vacía con su cuenta (contraseña temporal). */
function NewOrganizerForm({ kind }: { kind: Kind }) {
  const nightlife = kind === "NIGHTLIFE";
  return (
    <ActionForm action={createOrganizerAction} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="kind" value={kind} />
      <label className="label sm:col-span-2">
        {nightlife ? "Nombre del boliche" : "Nombre o razón social"}
        <input name="name" required className="field" placeholder={nightlife ? "Lounge 360" : "Producciones Andinas S.R.L."} />
      </label>
      <label className="label">
        NIT (opcional)
        <input name="taxId" className="field" />
      </label>
      <label className="label">
        Email de contacto (opcional)
        <input name="contactEmail" type="email" className="field" />
      </label>
      <label className="label">
        Responsable (nombre)
        <input name="adminName" required className="field" />
      </label>
      <label className="label">
        Email de su cuenta
        <input name="adminEmail" type="email" required autoComplete="off" className="field" />
      </label>
      <label className="label sm:col-span-2">
        Contraseña temporal
        <input name="adminPassword" type="text" required minLength={MIN_PASSWORD_LENGTH} autoComplete="off" className="field" />
        <span className="mt-1 block text-xs font-normal text-[var(--ink-dim)]">Envíasela con su email: al entrar por primera vez el sistema le pide que cree la suya.</span>
      </label>

      <fieldset className="sm:col-span-2">
        <legend className="label mb-1.5">¿Qué puede hacer {nightlife ? "el boliche" : "el organizador"}?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] p-3 text-sm has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
            <input type="radio" name="permission" value="view" defaultChecked className="mt-1 accent-[var(--accent)]" />
            <span>
              <span className="block font-medium">Solo ver</span>
              <span className="text-[var(--ink-muted)]">Ve en vivo {nightlife ? "sus noches" : "sus eventos"}, ventas e ingresos. Todo lo crea y cambia iPass.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] p-3 text-sm has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
            <input type="radio" name="permission" value="edit" className="mt-1 accent-[var(--accent)]" />
            <span>
              <span className="block font-medium">Ver y editar</span>
              <span className="text-[var(--ink-muted)]">Crea y edita lo suyo y maneja a su personal. Lo que publique pasa por tu aprobación.</span>
            </span>
          </label>
        </div>
        <p className="mt-1.5 text-xs text-[var(--ink-dim)]">Lo puedes cambiar después, en la lista o en su ficha.</p>
      </fieldset>

      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary">
          {nightlife ? "Crear boliche" : "Crear organizador"}
        </button>
      </div>
    </ActionForm>
  );
}
