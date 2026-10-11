import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { MIN_PASSWORD_LENGTH, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { createStaffAction, toggleStaffActiveAction } from "@/lib/actions/users";
import { ROLE_LABEL } from "@/lib/labels";
import { requirePlatform } from "@/lib/session";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersPage() {
  await connection();
  const staff = await requirePlatform();
  // En un organizador solo hay administradores, operadores de puerta y cajeros.
  const organizer = !staff.organization.isPlatform;
  const [members, clients] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId: staff.organization.id },
      orderBy: { createdAt: "asc" },
      include: { user: true, client: { select: { name: true } } },
    }),
    prisma.client.findMany({ where: { organizationId: staff.organization.id }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        {organizer && <p className="eyebrow">{staff.organization.name}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">
          {organizer ? "Cuentas del organizador" : "Usuarios de Impacta"}
        </h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {organizer
            ? "Solo Impacta crea cuentas. Cada una ve únicamente los eventos de este organizador: el administrador, todo lo suyo; el portero, la app móvil de puerta; el cajero, la boletería."
            : "No hay registro público: las cuentas se crean aquí. Cada rol ve solo lo suyo: el portero, la app móvil de puerta; el cajero, la boletería; el cliente, sus eventos mientras su espacio esté abierto."}{" "}
          La contraseña es temporal: la persona la cambia al entrar por primera vez.
        </p>
      </div>

      {!organizer && (
        <p role="note" className="rounded-xl border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-4 py-3 text-sm text-[var(--warn)]">
          Estás creando cuentas de <strong>Impacta</strong>: solo ven los eventos de Impacta. Para el portero, el cajero o el administrador de un
          organizador, entra primero en él: <Link href="/organizadores" className="font-semibold underline">Organizadores → Ver → Gestionar sus cuentas</Link>.
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="eyebrow border-b border-[var(--border)]">
            <tr>
              <th className="px-5 py-3 font-normal">Nombre</th>
              <th className="px-5 py-3 font-normal">Rol</th>
              <th className="px-5 py-3 font-normal">Estado</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {members.map((m) => (
              <tr key={m.id}>
                <td className="px-5 py-3">
                  <p className="font-medium">{m.user.name}</p>
                  <p className="font-mono text-xs text-[var(--ink-dim)]">{m.user.email}</p>
                </td>
                <td className="px-5 py-3">
                  {ROLE_LABEL[m.role]}
                  {m.client && <p className="text-xs text-[var(--ink-dim)]">{m.client.name}</p>}
                  {m.user.mustChangePassword && <p className="text-xs text-[var(--warn)]">Contraseña temporal</p>}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`badge ${m.user.active ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-2)] text-[var(--ink-dim)]"}`}
                  >
                    {m.user.active ? "Activo" : "Desactivado"}
                  </span>
                </td>
                <td className="flex items-center justify-end gap-2 px-5 py-3 text-right">
                  {m.role === "OPERATOR" && (
                    <Link href={`/usuarios/${m.userId}`} className="btn text-xs">
                      Funciones y teléfonos
                    </Link>
                  )}
                  {m.userId !== staff.id && (
                    <ActionForm action={toggleStaffActiveAction}>
                      <input type="hidden" name="userId" value={m.userId} />
                      <button type="submit" className="btn text-xs">
                        {m.user.active ? "Desactivar" : "Reactivar"}
                      </button>
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="card p-6">
        <h2 className="eyebrow mb-4">Nueva cuenta</h2>
        <ActionForm action={createStaffAction} resetOnSuccess successMessage="Cuenta creada." className="flex flex-wrap items-end gap-3">
          <label className="label">
            Nombre
            <input name="name" required className="field" />
          </label>
          <label className="label">
            Email
            <input name="email" type="email" required className="field" />
          </label>
          <label className="label">
            Rol
            <select name="role" defaultValue="OPERATOR" className="field">
              <option value="OPERATOR">{ROLE_LABEL.OPERATOR}</option>
              <option value="CASHIER">{ROLE_LABEL.CASHIER}</option>
              {!organizer && <option value="CLIENT">{ROLE_LABEL.CLIENT}</option>}
              <option value="ADMIN">{organizer ? "Administrador del organizador" : ROLE_LABEL.ADMIN}</option>
              {!organizer && staff.role === "OWNER" && <option value="OWNER">{ROLE_LABEL.OWNER}</option>}
            </select>
          </label>
          {!organizer && (
            <label className="label">
              Cliente (solo para el rol cliente)
              <select name="clientId" defaultValue="" className="field">
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="label">
            Contraseña temporal
            <input name="password" type="text" required minLength={MIN_PASSWORD_LENGTH} autoComplete="off" className="field" />
          </label>
          <button type="submit" className="btn btn-primary">
            Crear cuenta
          </button>
        </ActionForm>
      </section>
    </div>
  );
}
