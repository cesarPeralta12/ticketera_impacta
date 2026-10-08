import type { ReactNode } from "react";
import { NavLink, type NavIcon } from "@/components/nav-link";
import { signOut } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { ROLES, can, requireStaff } from "@/lib/session";

type NavItem = { href: string; label: string; icon: NavIcon };

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff([...ROLES.manage, ...ROLES.pos, ...ROLES.client]);

  const groups: { title: string; items: NavItem[] }[] = [
    ...(can(staff, ROLES.manage)
      ? [
          {
            title: "Gestión",
            items: [
              { href: "/", label: "Resumen", icon: "home" as const },
              { href: "/eventos", label: "Eventos", icon: "calendar" as const },
              { href: "/ordenes", label: "Órdenes", icon: "receipt" as const },
            ],
          },
          {
            title: "Catálogo",
            items: [
              { href: "/clientes", label: "Clientes", icon: "briefcase" as const },
              { href: "/recintos", label: "Recintos", icon: "map" as const },
            ],
          },
        ]
      : []),
    ...(can(staff, ROLES.pos) ? [{ title: "Venta", items: [{ href: "/boleteria", label: "Boletería", icon: "ticket" as const }] }] : []),
    ...(can(staff, ROLES.client) ? [{ title: "Mi espacio", items: [{ href: "/cliente", label: "Mis eventos", icon: "calendar" as const }] }] : []),
    ...(can(staff, ROLES.users) ? [{ title: "Equipo", items: [{ href: "/usuarios", label: "Usuarios y porteros", icon: "users" as const }] }] : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col md:flex-row print:block">
      <aside className="sidebar flex flex-col md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 print:hidden">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-base font-bold text-[var(--accent-ink)]">
            {staff.organization.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight">{staff.organization.name}</span>
            <span className="block truncate text-xs text-[var(--side-dim)]">{staff.client ? staff.client.name : "Panel de administración"}</span>
          </span>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-0.5 md:overflow-y-auto md:pb-0">
          {groups.map((group) => (
            <div key={group.title} className="flex gap-1 md:mb-3 md:block md:space-y-0.5">
              <p className="side-title hidden md:block">{group.title}</p>
              {group.items.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </div>
          ))}
        </nav>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--side-border)] px-4 py-3 md:block md:p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{staff.name}</p>
            <p className="text-xs text-[var(--side-dim)] md:mb-3">{ROLE_LABEL[staff.role]}</p>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="side-btn shrink-0">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-8 print:p-0">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
