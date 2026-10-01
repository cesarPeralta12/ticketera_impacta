import type { Metadata } from "next";
import { connection } from "next/server";
import { MIN_PASSWORD_LENGTH, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { createStaffAction, toggleStaffActiveAction } from "@/lib/actions/users";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Usuarios" };

const roleLabel = { OWNER: "Dueño", ADMIN: "Administrador", OPERATOR: "Operador de puerta" } as const;

export default async function UsersPage() {
  await connection();
  const staff = await requireStaff(ROLES.users);
  const members = await prisma.membership.findMany({
    where: { organizationId: staff.organization.id },
    orderBy: { createdAt: "asc" },
    include: { user: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usuarios del panel</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          No hay registro público: las cuentas se crean aquí. Un operador de puerta solo ve el control de acceso.
        </p>
      </div>

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
                <td className="px-5 py-3">{roleLabel[m.role]}</td>
                <td className="px-5 py-3">
                  <span
                    className={`badge ${m.user.active ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-2)] text-[var(--ink-dim)]"}`}
                  >
                    {m.user.active ? "Activo" : "Desactivado"}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
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
              <option value="OPERATOR">Operador de puerta</option>
              <option value="ADMIN">Administrador</option>
              {staff.role === "OWNER" && <option value="OWNER">Dueño</option>}
            </select>
          </label>
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
