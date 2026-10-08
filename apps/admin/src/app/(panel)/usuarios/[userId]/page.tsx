import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { assignDoorAction, revokeDeviceAction, unassignDoorAction } from "@/lib/actions/door";
import { ROLE_LABEL } from "@/lib/labels";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Portero" };

const dayAgo = () => new Date(Date.now() - 24 * 60 * 60_000);
const sessionOpen = (d: { revokedAt: Date | null; expiresAt: Date }) => !d.revokedAt && d.expiresAt > new Date();

/** Un portero: qué funciones puede controlar con la app y qué teléfonos tienen su sesión abierta. */
export default async function OperatorPage({ params }: { params: Promise<{ userId: string }> }) {
  await connection();
  const staff = await requireStaff(ROLES.users);
  const { userId } = await params;

  const member = await prisma.membership.findFirst({
    where: { userId, organizationId: staff.organization.id },
    include: { user: true },
  });
  if (!member) notFound();
  const isOperator = member.role === "OPERATOR";

  const [assignments, sessions, devices] = await Promise.all([
    prisma.doorAssignment.findMany({
      where: { userId, session: { event: { organizationId: staff.organization.id } } },
      orderBy: { session: { startsAt: "asc" } },
      include: { accessPoint: true, session: { include: { event: { select: { title: true } }, venue: { select: { name: true, timezone: true } } } } },
    }),
    prisma.eventSession.findMany({
      where: {
        cancelledAt: null,
        startsAt: { gte: dayAgo() },
        event: { organizationId: staff.organization.id, status: { not: "CANCELLED" } },
      },
      orderBy: { startsAt: "asc" },
      take: 100,
      include: {
        event: { select: { title: true } },
        venue: { select: { name: true, timezone: true, accessPoints: { orderBy: { name: "asc" } } } },
      },
    }),
    prisma.deviceToken.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/usuarios" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Usuarios
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{member.user.name}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {member.user.email} · {ROLE_LABEL[member.role]}
        </p>
      </div>

      {isOperator ? (
        <section className="card p-6">
          <h2 className="eyebrow mb-1">Funciones asignadas</h2>
          <p className="mb-4 text-sm text-[var(--ink-muted)]">
            Una cuenta por puerta: al iniciar sesión en la app, el portero ve estas funciones y la app descarga
            sola las entradas de su puerta, sin pedirle que la elija.
          </p>

          {assignments.length === 0 ? (
            <p className="mb-4 rounded-md bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">
              Sin funciones asignadas: al iniciar sesión en la app no verá ningún evento.
            </p>
          ) : (
            <ul className="mb-5 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {assignments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span>
                    <span className="block font-medium">{a.session.event.title}</span>
                    <span className="text-sm text-[var(--ink-muted)]">
                      {formatDateTime(a.session.startsAt, a.session.venue.timezone)} · {a.session.venue.name} ·{" "}
                      {a.accessPoint ? a.accessPoint.name : "sin puerta (asígnala)"}
                    </span>
                  </span>
                  <ActionForm action={unassignDoorAction} confirm="¿Quitar esta función del portero?">
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                      Quitar
                    </button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}

          {sessions.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">No hay funciones próximas para asignar.</p>
          ) : (
            <ActionForm action={assignDoorAction} successMessage="Asignado." className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="userId" value={userId} />
              <label className="label">
                Función
                <select name="sessionId" required className="field min-w-64">
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.event.title} · {formatDateTime(s.startsAt, s.venue.timezone)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                Puerta
                <select name="accessPointId" required defaultValue="" className="field">
                  <option value="" disabled>
                    Elige la puerta
                  </option>
                  {[...new Map(sessions.flatMap((s) => s.venue.accessPoints).map((g) => [g.id, g])).values()].map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-primary">
                Asignar
              </button>
            </ActionForm>
          )}
        </section>
      ) : (
        <p className="card p-5 text-sm text-[var(--ink-muted)]">
          Solo las cuentas de <strong>{ROLE_LABEL.OPERATOR}</strong> usan asignaciones. Los dueños y administradores ven
          todas las funciones próximas en la app.
        </p>
      )}

      <section className="card p-6">
        <h2 className="eyebrow mb-3">Teléfonos con sesión</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">Todavía no inició sesión en ningún teléfono.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="eyebrow border-b border-[var(--border)]">
                <tr>
                  <th className="py-2 pr-4 font-normal">Teléfono</th>
                  <th className="py-2 pr-4 font-normal">Última actividad</th>
                  <th className="py-2 pr-4 font-normal">Estado</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {devices.map((d) => {
                  const active = sessionOpen(d);
                  return (
                    <tr key={d.id}>
                      <td className="py-2.5 pr-4 font-medium">{d.deviceName}</td>
                      <td className="py-2.5 pr-4 text-[var(--ink-muted)]">
                        {formatDateTime(d.lastSeenAt, "America/La_Paz")}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`badge ${active ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-2)] text-[var(--ink-dim)]"}`}
                        >
                          {active ? "Activo" : "Cerrado"}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        {active && (
                          <ActionForm action={revokeDeviceAction} confirm="¿Cerrar la sesión de este teléfono?">
                            <input type="hidden" name="deviceTokenId" value={d.id} />
                            <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                              Cerrar sesión
                            </button>
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
