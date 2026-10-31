import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { MIN_PASSWORD_LENGTH, prisma } from "@ticketera/db";
import { AccountFields } from "@/components/account-fields";
import { ActionForm } from "@/components/action-form";
import { STAFF_ROLES } from "@/lib/account-scope";
import { createStaffAction, toggleStaffActiveAction } from "@/lib/actions/users";
import { ROLE_LABEL } from "@/lib/labels";
import { isGlobalView, requireAccountAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Usuarios" };

type Props = { searchParams: Promise<{ org?: string }> };

/**
 * Cuentas del panel. iPass ve y crea las de todos los organizadores y boliches desde aquí, sin "entrar" en ellos (puede
 * filtrar por organizador). Un organizador con administración propia ve y crea solo las de su personal.
 */
export default async function UsersPage({ searchParams }: Props) {
  await connection();
  const staff = await requireAccountAdmin();
  const global = isGlobalView(staff);
  const filter = (await searchParams).org ?? "";

  const organizations = staff.platform
    ? await prisma.organization.findMany({ orderBy: [{ isPlatform: "desc" }, { name: "asc" }], select: { id: true, name: true, isPlatform: true, kind: true, status: true } })
    : [];
  // iPass dentro de un organizador ("entró"): ve las de ese organizador. En su vista general: todas, o las del filtro.
  const scopeOrgId = global ? (filter && organizations.some((o) => o.id === filter) ? filter : null) : staff.organization.id;

  const [members, clients] = await Promise.all([
    prisma.membership.findMany({
      where: scopeOrgId ? { organizationId: scopeOrgId } : {},
      orderBy: [{ organization: { isPlatform: "desc" } }, { organization: { name: "asc" } }, { createdAt: "asc" }],
      include: { user: true, client: { select: { name: true } }, organization: { select: { name: true, isPlatform: true, kind: true } } },
    }),
    prisma.client.findMany({ where: { organizationId: staff.organization.isPlatform ? staff.organization.id : "-" }, orderBy: { name: "asc" } }),
  ]);

  const orgOptions = organizations.filter((o) => o.isPlatform || o.status === "ACTIVE").map((o) => ({ id: o.id, name: o.name, platform: o.isPlatform, nightlife: o.kind === "NIGHTLIFE" }));
  const createOrgId = scopeOrgId ?? staff.organization.id;
  const manageable = (role: string) => staff.platform || (STAFF_ROLES as string[]).includes(role);
  const currentOrg = organizations.find((o) => o.id === scopeOrgId);
  const title = !global ? (staff.platform ? "Cuentas del organizador" : "Mi personal") : "Usuarios";

  return (
    <div className="space-y-6">
      <div>
        {!staff.organization.isPlatform && <p className="eyebrow">{staff.organization.name}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {staff.platform
            ? "Crea y administra las cuentas de iPass y de todos los organizadores y boliches, sin entrar en cada uno: portero, cajero, barra, promotor y administrador. Cada una ve solo lo suyo."
            : "Crea las cuentas de tu personal: portero (app de puerta), cajero (boletería), barra (QR de consumo) y promotor. Cada una ve solo lo suyo."}{" "}
          La contraseña es temporal: la persona la cambia al entrar por primera vez.
        </p>
      </div>

      {global && organizations.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--ink-dim)]">Ver:</span>
          {[{ id: "", name: "Todos" }, ...organizations.map((o) => ({ id: o.id, name: o.isPlatform ? "iPass" : o.name }))].map((o) => (
            <Link
              key={o.id || "todos"}
              href={o.id ? `/usuarios?org=${o.id}` : "/usuarios"}
              className={`rounded-full border px-3 py-1 ${(scopeOrgId ?? "") === o.id ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent)]" : "border-[var(--border)] text-[var(--ink-muted)] hover:text-[var(--ink)]"}`}
            >
              {o.name}
            </Link>
          ))}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="eyebrow border-b border-[var(--border)]">
            <tr>
              <th className="px-5 py-3 font-normal">Nombre</th>
              {global && !scopeOrgId && <th className="px-5 py-3 font-normal">Organización</th>}
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
                {global && !scopeOrgId && (
                  <td className="px-5 py-3 text-[var(--ink-muted)]">
                    {m.organization.isPlatform ? "iPass" : m.organization.name}
                    {m.organization.kind === "NIGHTLIFE" && !m.organization.isPlatform && <span className="badge ml-1.5 bg-[var(--surface-2)] text-[var(--ink-muted)]">boliche</span>}
                  </td>
                )}
                <td className="px-5 py-3">
                  {ROLE_LABEL[m.role]}
                  {m.client && <p className="text-xs text-[var(--ink-dim)]">{m.client.name}</p>}
                  {m.user.mustChangePassword && <p className="text-xs text-[var(--warn)]">Contraseña temporal</p>}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`badge ${m.user.active ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--surface-2)] text-[var(--ink-dim)]"}`}
                  >
                    {m.user.active ? "Activo" : "Desactivado"}
                  </span>
                </td>
                <td className="flex items-center justify-end gap-2 px-5 py-3 text-right">
                  {manageable(m.role) && m.role === "OPERATOR" && (
                    <Link href={`/usuarios/${m.userId}`} className="btn text-xs">
                      Funciones y teléfonos
                    </Link>
                  )}
                  {manageable(m.role) && m.role === "CASHIER" && (
                    <Link href={`/usuarios/${m.userId}`} className="btn text-xs">
                      Qué puede vender
                    </Link>
                  )}
                  {manageable(m.role) && m.role === "BAR" && (
                    <Link href={`/usuarios/${m.userId}`} className="btn text-xs">
                      Noches que atiende
                    </Link>
                  )}
                  {manageable(m.role) && m.role === "PROMOTER" && (
                    <Link href={`/promotores/${m.userId}`} className="btn text-xs">
                      Eventos y comisión
                    </Link>
                  )}
                  {m.userId !== staff.id && manageable(m.role) && (
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
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-[var(--ink-muted)]">
                  Todavía no hay cuentas{currentOrg ? ` en ${currentOrg.name}` : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section data-tour="crear-cuenta" className="card p-6">
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
          <AccountFields
            key={createOrgId}
            orgs={staff.platform ? orgOptions : [{ id: staff.organization.id, name: staff.organization.name, platform: false, nightlife: staff.organization.kind === "NIGHTLIFE" }]}
            defaultOrgId={createOrgId}
            chooseOrg={staff.platform}
            canMakeAdmins={staff.platform}
            canMakeOwners={staff.platform && staff.role === "OWNER"}
            clients={clients}
          />
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
