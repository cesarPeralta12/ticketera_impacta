import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatMoney } from "@ticketera/core";
import { MIN_PASSWORD_LENGTH, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { createOrganizerAction, enterOrganizationAction } from "@/lib/actions/platform";
import { requirePlatform } from "@/lib/session";

export const metadata: Metadata = { title: "Organizadores" };

/** Organizadores con sus cifras: eventos por estado, entradas vendidas y lo recaudado. */
async function organizersWithStats() {
  const organizations = await prisma.organization.findMany({
    where: { isPlatform: false },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true, venues: true } } },
  });
  return Promise.all(
    organizations.map(async (org) => {
      const byOrg = { event: { organizationId: org.id } };
      const [events, tickets, revenue] = await Promise.all([
        prisma.event.groupBy({ by: ["status"], where: { organizationId: org.id }, _count: true }),
        prisma.ticket.count({ where: { status: { in: ["VALID", "USED"] }, session: byOrg } }),
        prisma.order.aggregate({
          _sum: { totalAmount: true },
          where: { status: "PAID", items: { some: { ticketType: { session: byOrg } } } },
        }),
      ]);
      const count = (status: string) => events.find((e) => e.status === status)?._count ?? 0;
      return {
        ...org,
        published: count("PUBLISHED"),
        pending: count("PENDING_REVIEW"),
        drafts: count("DRAFT"),
        tickets,
        revenue: revenue._sum.totalAmount ?? 0,
      };
    }),
  );
}

export default async function OrganizersPage() {
  await connection();
  await requirePlatform();
  const organizers = await organizersWithStats();

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{organizers.length} organizador(es)</p>
        <h1 className="text-2xl font-semibold tracking-tight">Organizadores</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Productoras a las que Impacta les da el servicio. Cada una tiene su propio panel: arma sus recintos y eventos,
          vende, controla su puerta y ve sus reportes, sin ver nada de las demás. Sus eventos salen en la web cuando
          Impacta los aprueba.
        </p>
      </div>

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
                  Todavía no hay organizadores. Crea el primero aquí abajo.
                </td>
              </tr>
            )}
            {organizers.map((o) => (
              <tr key={o.id} className="align-top">
                <td className="px-5 py-3">
                  <Link href={`/organizadores/${o.id}`} className="font-medium hover:text-[var(--accent)]">
                    {o.name}
                  </Link>
                  <p className="text-xs text-[var(--ink-dim)]">
                    {[o.taxId && `NIT ${o.taxId}`, o.contactEmail].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                  </p>
                  <p className="text-xs text-[var(--ink-dim)]">
                    {o._count.members} cuenta(s) · {o._count.venues} recinto(s)
                  </p>
                </td>
                <td className="px-5 py-3 text-xs">
                  <p>{o.published} publicado(s)</p>
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
                    className={`badge ${o.status === "ACTIVE" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}
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

      <section className="card p-6">
        <h2 className="eyebrow mb-1">Nuevo organizador</h2>
        <p className="mb-4 text-sm text-[var(--ink-muted)]">
          Se crea vacío, con una cuenta de administrador. Envíale su email y la contraseña temporal: al entrar por
          primera vez el sistema le pide que cree la suya.
        </p>
        <ActionForm
          action={createOrganizerAction}
          resetOnSuccess
          successMessage="Organizador creado. Ya puede entrar al panel con su email y la contraseña temporal."
          className="grid gap-4 md:grid-cols-3"
        >
          <label className="label">
            Nombre o razón social
            <input name="name" required className="field" placeholder="Producciones Andinas S.R.L." />
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
            <input
              name="adminPassword"
              type="text"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="off"
              className="field"
            />
          </label>
          <div className="md:col-span-3">
            <button type="submit" className="btn btn-primary">
              Crear organizador
            </button>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
