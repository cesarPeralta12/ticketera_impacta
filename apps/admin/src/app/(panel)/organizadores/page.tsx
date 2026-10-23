import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatMoney } from "@ticketera/core";
import { MIN_PASSWORD_LENGTH, getEventQuota, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { createOrganizerAction, enterOrganizationAction } from "@/lib/actions/platform";
import { requirePlatform } from "@/lib/session";

export const metadata: Metadata = { title: "Organizadores" };

type Kind = "EVENTS" | "NIGHTLIFE";
const KIND_FROM_PARAM: Record<string, Kind> = { eventos: "EVENTS", boliche: "NIGHTLIFE" };

/** Organizadores con sus cifras: eventos por estado, entradas vendidas y lo recaudado. */
async function organizersWithStats(kind?: Kind) {
  const organizations = await prisma.organization.findMany({
    where: { isPlatform: false, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true, venues: true } } },
  });
  return Promise.all(
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
}

type Props = { searchParams: Promise<{ tipo?: string }> };

export default async function OrganizersPage({ searchParams }: Props) {
  await connection();
  await requirePlatform();
  const kind = KIND_FROM_PARAM[(await searchParams).tipo ?? ""];
  const organizers = await organizersWithStats(kind);
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${active ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent)]" : "border-[var(--border)] text-[var(--ink-muted)] hover:text-[var(--ink)]"}`;
  // Primero el formulario del tipo que se está mirando.
  const forms: Kind[] = kind === "NIGHTLIFE" ? ["NIGHTLIFE", "EVENTS"] : ["EVENTS", "NIGHTLIFE"];

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{organizers.length} organizador(es)</p>
        <h1 className="text-2xl font-semibold tracking-tight">{kind === "NIGHTLIFE" ? "Boliches" : kind === "EVENTS" ? "Organizadores de eventos" : "Organizadores"}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Clientes a los que iPass les da el servicio: organizadores de eventos y boliches. Cada uno tiene su panel de{" "}
          <strong>solo lectura</strong>: ve en vivo sus eventos (o noches), ventas, compradores, ingresos y reportes, sin
          ver nada de los demás. Todo lo que se crea o cambia lo hace iPass: entra con &ldquo;Entrar&rdquo; y trabaja
          dentro de su panel.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Tipo de organizador">
        <Link href="/organizadores" className={chip(!kind)}>
          Todos
        </Link>
        <Link href="/organizadores?tipo=eventos" className={chip(kind === "EVENTS")}>
          Eventos
        </Link>
        <Link href="/organizadores?tipo=boliche" className={chip(kind === "NIGHTLIFE")}>
          Boliches
        </Link>
      </nav>

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="eyebrow border-b border-[var(--border)]">
            <tr>
              <th className="px-5 py-3 font-normal">Organizador</th>
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
                <td colSpan={6} className="px-5 py-6 text-center text-[var(--ink-muted)]">
                  {kind === "NIGHTLIFE" ? "Todavía no hay boliches." : "Todavía no hay organizadores."} Crea el primero aquí
                  abajo.
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

      {forms.map((k) => (
        <NewOrganizerForm key={k} kind={k} />
      ))}
    </div>
  );
}

/** Alta de un usuario de eventos o de boliche: organización nueva y vacía con su cuenta de solo lectura. */
function NewOrganizerForm({ kind }: { kind: Kind }) {
  const nightlife = kind === "NIGHTLIFE";
  return (
    <section data-tour="nuevo-organizador" className={`card p-6 ${nightlife ? "border-[var(--accent)]/40" : ""}`}>
      <h2 className="eyebrow mb-1">{nightlife ? "Nuevo usuario de boliche" : "Nuevo usuario de eventos"}</h2>
      <p className="mb-4 text-sm text-[var(--ink-muted)]">
        {nightlife
          ? "Discoteca, boliche o lounge: su panel muestra noches, mesas, consumo en barra, free por horario, ventas e ingresos."
          : "Productora de conciertos, teatro, festivales u otros eventos: su panel muestra sus eventos, ventas, compradores e ingresos."}{" "}
        Se crea vacío, con una cuenta de solo lectura. Envíale su email y la contraseña temporal: al entrar por primera vez
        el sistema le pide que cree la suya.
      </p>
      <ActionForm action={createOrganizerAction} resetOnSuccess className="grid gap-4 md:grid-cols-3">
        <input type="hidden" name="kind" value={kind} />
        <label className="label">
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
        <label className="label">
          Contraseña temporal
          <input name="adminPassword" type="text" required minLength={MIN_PASSWORD_LENGTH} autoComplete="off" className="field" />
        </label>
        <div className="md:col-span-3">
          <button type="submit" className="btn btn-primary">
            {nightlife ? "Crear usuario de boliche" : "Crear usuario de eventos"}
          </button>
        </div>
      </ActionForm>
    </section>
  );
}
