import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { MIN_PASSWORD_LENGTH, StaffRole, prisma } from "@ticketera/db";
import { AccountFields } from "@/components/account-fields";
import { ActionForm } from "@/components/action-form";
import { FilterForm } from "@/components/filter-form";
import { ModalButton } from "@/components/modal";
import { PAGE_SIZE, Pager, pageFrom } from "@/components/pager";
import { STAFF_ROLES } from "@/lib/account-scope";
import { createStaffAction, toggleStaffActiveAction } from "@/lib/actions/users";
import { ROLE_LABEL } from "@/lib/labels";
import { isGlobalView, requireAccountAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Usuarios" };

/** Organizaciones por página: cada una es un grupo con sus cuentas. */
const GROUPS_PER_PAGE = 8;

type Props = { searchParams: Promise<{ q?: string; org?: string; rol?: string; estado?: string; pagina?: string }> };

/**
 * Cuentas del panel, agrupadas por organización. iPass ve y crea las de todos los organizadores y boliches desde aquí, sin
 * "entrar" en ellos; busca por nombre, correo u organización y filtra por organizador, rol y estado. Un organizador con
 * administración propia ve y crea solo las de su personal.
 */
export default async function UsersPage({ searchParams }: Props) {
  await connection();
  const staff = await requireAccountAdmin();
  const global = isGlobalView(staff);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const role = Object.values(StaffRole).find((r) => r === sp.rol);
  const estado = sp.estado === "activo" || sp.estado === "desactivado" ? sp.estado : "";

  const organizations = staff.platform
    ? await prisma.organization.findMany({ orderBy: [{ isPlatform: "desc" }, { name: "asc" }], select: { id: true, name: true, isPlatform: true, kind: true, status: true } })
    : [];
  // iPass dentro de un organizador ("entró"): ve las de ese organizador. En su vista general: todas, o las de la organización elegida.
  const scopeOrgId = global ? (sp.org && organizations.some((o) => o.id === sp.org) ? sp.org : null) : staff.organization.id;

  const [matching, clients] = await Promise.all([
    prisma.membership.findMany({
      where: {
        ...(scopeOrgId ? { organizationId: scopeOrgId } : {}),
        ...(role ? { role } : {}),
        ...(estado ? { user: { active: estado === "activo" } } : {}),
        ...(q
          ? {
              OR: [
                { user: { name: { contains: q, mode: "insensitive" } } },
                { user: { email: { contains: q, mode: "insensitive" } } },
                { organization: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: [{ organization: { isPlatform: "desc" } }, { organization: { name: "asc" } }, { createdAt: "asc" }],
      include: { user: true, client: { select: { name: true } }, organization: { select: { id: true, name: true, isPlatform: true, kind: true, selfManaged: true } } },
    }),
    prisma.client.findMany({ where: { organizationId: staff.organization.isPlatform ? staff.organization.id : "-" }, orderBy: { name: "asc" } }),
  ]);

  // Agrupa por organización y pagina los grupos.
  const byOrganization = new Map<string, typeof matching>();
  for (const m of matching) byOrganization.set(m.organizationId, [...(byOrganization.get(m.organizationId) ?? []), m]);
  const groups = [...byOrganization.values()];
  // Una sola organización: sus cuentas van de a 50, con páginas. Varias: grupos de a 8, con hasta 50 cuentas cada uno.
  const single = Boolean(scopeOrgId);
  const pageSize = single ? PAGE_SIZE : GROUPS_PER_PAGE;
  const pagedTotal = single ? matching.length : groups.length;
  const page = pageFrom(sp.pagina, Math.ceil(pagedTotal / pageSize));
  const shown = single ? (groups[0] ? [groups[0].slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)] : []) : groups.slice((page - 1) * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE).map((g) => g.slice(0, PAGE_SIZE));
  const filtered = Boolean(q || role || estado || sp.org);
  const manageable = (r: string) => staff.platform || (STAFF_ROLES as string[]).includes(r);

  const orgOptions = organizations.filter((o) => o.isPlatform || o.status === "ACTIVE").map((o) => ({ id: o.id, name: o.name, platform: o.isPlatform, nightlife: o.kind === "NIGHTLIFE" }));
  const createOrgId = scopeOrgId ?? staff.organization.id;
  const title = !global ? (staff.platform ? "Cuentas del organizador" : "Mi personal") : "Usuarios";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {!staff.organization.isPlatform && <p className="eyebrow">{staff.organization.name}</p>}
          <p className="eyebrow">
            {matching.length} cuenta(s){groups.length > 1 ? ` · ${groups.length} organizaciones` : ""}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-muted)]">
            {staff.platform
              ? "Las cuentas de iPass y de todos los organizadores y boliches, agrupadas por organización: portero, cajero, barra, promotor y administrador. Cada una ve solo lo suyo."
              : "Las cuentas de tu personal: portero (app de puerta), cajero (boletería), barra (QR de consumo) y promotor. Cada una ve solo lo suyo."}{" "}
            La contraseña es temporal: la persona la cambia al entrar por primera vez.
          </p>
        </div>
        <div data-tour="crear-cuenta">
          <ModalButton
            label="+ Crear cuenta"
            title="Crear cuenta"
            description="La persona entra con su email y una contraseña temporal; al entrar por primera vez crea la suya."
            primary
          >
            <ActionForm action={createStaffAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
              <label className="label">
                Nombre
                <input name="name" required className="field" />
              </label>
              <label className="label">
                Email
                <input name="email" type="email" required autoComplete="off" className="field" />
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
          </ModalButton>
        </div>
      </div>

      <FilterForm key={JSON.stringify(sp)}>
        <label className="label grow basis-56">
          Buscar
          <input type="search" name="q" defaultValue={q} placeholder="Nombre, correo u organización" className="field" autoComplete="off" />
        </label>
        {global && organizations.length > 1 && (
          <label className="label">
            Organización
            <select name="org" defaultValue={scopeOrgId ?? ""} className="field max-w-56">
              <option value="">Todas</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.isPlatform ? "iPass" : `${o.name}${o.kind === "NIGHTLIFE" ? " · boliche" : ""}`}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="label">
          Rol
          <select name="rol" defaultValue={role ?? ""} className="field">
            <option value="">Todos</option>
            {Object.values(StaffRole)
              .filter((r) => staff.platform || (STAFF_ROLES as string[]).includes(r))
              .map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
          </select>
        </label>
        <label className="label">
          Estado
          <select name="estado" defaultValue={estado} className="field">
            <option value="">Todos</option>
            <option value="activo">Activos</option>
            <option value="desactivado">Desactivados</option>
          </select>
        </label>
      </FilterForm>

      {shown.length === 0 && (
        <p className="card p-6 text-center text-[var(--ink-muted)]">{filtered ? "Ninguna cuenta coincide con la búsqueda." : "Todavía no hay cuentas."}</p>
      )}

      <div className="space-y-3">
        {shown.map((members) => {
          const org = members[0]!.organization;
          const groupTotal = byOrganization.get(org.id)?.length ?? members.length;
          return (
            <details key={org.id} open={shown.length === 1 || filtered || undefined} className="card group overflow-hidden">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-[var(--surface-2)]">
                <span className="text-xs text-[var(--ink-dim)] transition-transform group-open:rotate-90">▶</span>
                <span className="font-semibold">{org.isPlatform ? "iPass" : org.name}</span>
                {org.kind === "NIGHTLIFE" && !org.isPlatform && <span className="badge bg-[var(--accent-soft)] text-[var(--accent-hover)]">boliche</span>}
                {!org.isPlatform && (
                  <span className={`badge ${org.selfManaged ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--surface-2)] text-[var(--ink-muted)]"}`}>
                    {org.selfManaged ? "Edita (con aprobación)" : "Solo ver"}
                  </span>
                )}
                <span className="ml-auto text-xs text-[var(--ink-dim)]">{groupTotal} cuenta(s)</span>
              </summary>
              <table className="w-full border-t border-[var(--border)] text-left text-sm">
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
                        <span className={`badge ${m.user.active ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--surface-2)] text-[var(--ink-dim)]"}`}>
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
                </tbody>
              </table>
              {!single && groupTotal > members.length && (
                <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--ink-dim)]">
                  Mostrando {members.length} de {groupTotal}.{" "}
                  <Link href={`/usuarios?org=${org.id}`} className="font-medium text-[var(--accent)] hover:underline">
                    Ver todas las cuentas de {org.isPlatform ? "iPass" : org.name} →
                  </Link>
                </p>
              )}
            </details>
          );
        })}
      </div>

      <Pager path="/usuarios" params={{ q, org: sp.org, rol: role, estado }} page={page} total={pagedTotal} size={pageSize} />
    </div>
  );
}
