import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, formatDateTime } from "@ticketera/core";
import { getEventQuota, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { enterOrganizationAction, setEventLimitAction, setOrganizerStatusAction } from "@/lib/actions/platform";
import { EVENT_STATUS, ROLE_LABEL } from "@/lib/labels";
import { requirePlatform } from "@/lib/session";

export const metadata: Metadata = { title: "Organizador" };

type Props = { params: Promise<{ id: string }> };

/** Entra en el organizador y abre una página de su panel. */
function EnterButton({ organizationId, next, label, primary }: { organizationId: string; next: string; label: string; primary?: boolean }) {
  return (
    <form action={enterOrganizationAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="next" value={next} />
      <button type="submit" className={`btn text-xs ${primary ? "btn-primary" : ""}`}>
        {label}
      </button>
    </form>
  );
}

export default async function OrganizerPage({ params }: Props) {
  await connection();
  await requirePlatform();
  const organizer = await prisma.organization.findFirst({
    where: { id: (await params).id, isPlatform: false },
    include: {
      members: { orderBy: { createdAt: "asc" }, include: { user: true } },
      events: {
        orderBy: { createdAt: "desc" },
        include: { sessions: { where: { cancelledAt: null }, orderBy: { startsAt: "asc" }, take: 1, include: { venue: true } } },
      },
    },
  });
  if (!organizer) notFound();
  const active = organizer.status === "ACTIVE";
  const quota = await getEventQuota(organizer.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/organizadores" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ← Organizadores
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{organizer.name}</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {[organizer.taxId && `NIT ${organizer.taxId}`, organizer.contactEmail].filter(Boolean).join(" · ") ||
              "Sin datos de contacto"}{" "}
            · alta el {formatDateTime(organizer.createdAt, DEFAULT_TIMEZONE)}
          </p>
        </div>
        <span
          className={`badge ${active ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}
        >
          {active ? "Activo" : "Suspendido"}
        </span>
      </div>

      <section className="card flex flex-wrap items-center gap-3 p-5">
        <EnterButton organizationId={organizer.id} next="/" label="Entrar a su panel" primary />
        <EnterButton organizationId={organizer.id} next="/usuarios" label="Gestionar sus cuentas" />
        <ActionForm
          action={setOrganizerStatusAction}
          confirm={
            active
              ? `¿Suspender a ${organizer.name}? Sus cuentas no podrán entrar y sus eventos dejan de mostrarse y venderse.`
              : `¿Reactivar a ${organizer.name}?`
          }
          className="ml-auto"
        >
          <input type="hidden" name="organizationId" value={organizer.id} />
          <input type="hidden" name="status" value={active ? "SUSPENDED" : "ACTIVE"} />
          <button type="submit" className={`btn text-xs ${active ? "text-[var(--danger)]" : ""}`}>
            {active ? "Suspender" : "Reactivar"}
          </button>
        </ActionForm>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="eyebrow mb-1">Límite de eventos</h2>
            <p className="text-sm">
              <strong className={`tabular-nums ${quota.reached ? "text-[var(--warn)]" : ""}`}>{quota.used}</strong>
              {quota.limit === null ? " eventos activos · sin límite" : ` de ${quota.limit} ${quota.limit === 1 ? "evento activo" : "eventos activos"}`}
              {quota.reached && <span className="badge ml-2 bg-[var(--warn-soft)] text-[var(--warn)]">límite alcanzado</span>}
            </p>
            <p className="mt-1 text-xs text-[var(--ink-dim)]">
              Cuenta los borradores, los eventos en revisión y los publicados que todavía tienen funciones por venir. No cuenta los cancelados ni los ya
              realizados. Solo frena la creación de eventos nuevos: bajar el límite no borra nada.
            </p>
          </div>
          <ActionForm action={setEventLimitAction} successMessage="Límite guardado." className="flex items-end gap-2">
            <input type="hidden" name="organizationId" value={organizer.id} />
            <label className="label">
              Máximo de eventos activos
              <input name="maxActiveEvents" type="number" min={0} max={10000} defaultValue={quota.limit ?? ""} placeholder="sin límite" className="field w-40" />
            </label>
            <button type="submit" className="btn">
              Guardar
            </button>
          </ActionForm>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="eyebrow mb-3">Cuentas ({organizer.members.length})</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {organizer.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className={m.user.active ? "font-medium" : "font-medium text-[var(--ink-dim)] line-through"}>
                    {m.user.name}
                  </span>
                  <span className="block font-mono text-xs text-[var(--ink-dim)]">{m.user.email}</span>
                </span>
                <span className="text-right text-xs text-[var(--ink-muted)]">
                  {m.role === "ADMIN" ? "Administrador" : ROLE_LABEL[m.role]}
                  {m.user.mustChangePassword && <span className="block text-[var(--warn)]">Contraseña temporal</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--ink-dim)]">
            Para crear o desactivar cuentas (administradores, puerta, caja): &ldquo;Gestionar sus cuentas&rdquo;.
          </p>
        </section>

        <section className="card p-5">
          <h2 className="eyebrow mb-3">Eventos ({organizer.events.length})</h2>
          {organizer.events.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Todavía no cargó eventos.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {organizer.events.map((e) => {
                const first = e.sessions[0];
                const status = EVENT_STATUS[e.status];
                return (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{e.title}</span>
                      <span className="block text-xs text-[var(--ink-dim)]">
                        {first ? `${formatDateTime(first.startsAt, first.venue.timezone)} · ${first.venue.name}` : "Sin funciones"}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`badge ${status.className}`}>{status.text}</span>
                      <EnterButton organizationId={organizer.id} next={`/eventos/${e.id}`} label="Abrir" />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
