import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { prisma } from "@ticketera/db";
import { NavLink, type NavIcon } from "@/components/nav-link";
import { exitOrganizationAction } from "@/lib/actions/platform";
import { signOut } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { ROLES, can, isGlobalView, requireStaff, type Staff } from "@/lib/session";

type NavItem = { href: string; label: string; icon: NavIcon; badge?: number };
type NavGroup = { title?: string; items: NavItem[] };

/** El menú depende de quién entra: IMPACTA (general o dentro de un organizador), un organizador o su personal. */
async function navigation(staff: Staff): Promise<NavGroup[]> {
  // El control de acceso se hace con la app móvil de puerta: el panel no tiene pantalla de lectura.
  const operate: NavItem[] = can(staff, ROLES.pos) ? [{ href: "/boleteria", label: "Boletería", icon: "ticket" }] : [];

  if (isGlobalView(staff)) {
    const pending = await prisma.event.count({ where: { status: "PENDING_REVIEW" } });
    return [
      {
        title: "Plataforma",
        items: [
          { href: "/", label: "Resumen general", icon: "home" },
          { href: "/organizadores", label: "Organizadores", icon: "briefcase" },
          { href: "/aprobaciones", label: "Aprobaciones", icon: "check", badge: pending },
          { href: "/ordenes", label: "Ventas", icon: "receipt" },
          { href: "/ingresos", label: "Ingresos en puerta", icon: "door" },
        ],
      },
      {
        title: "Eventos de Impacta",
        items: [
          { href: "/eventos", label: "Eventos", icon: "calendar" },
          { href: "/clientes", label: "Clientes", icon: "briefcase" },
          { href: "/recintos", label: "Recintos", icon: "map" },
          ...operate,
        ],
      },
      { title: "Cuentas", items: [{ href: "/usuarios", label: "Usuarios y porteros", icon: "users" }] },
    ];
  }

  if (can(staff, ROLES.manage)) {
    return [
      {
        items: [
          { href: "/", label: "Resumen", icon: "home" },
          { href: "/eventos", label: "Eventos", icon: "calendar" },
          { href: "/recintos", label: "Recintos", icon: "map" },
          { href: "/ordenes", label: "Ventas", icon: "receipt" },
          { href: "/ingresos", label: "Ingresos en puerta", icon: "door" },
          ...operate,
          // Las cuentas de un organizador las crea IMPACTA (al entrar en él).
          ...(staff.platform ? [{ href: "/usuarios", label: "Usuarios y porteros", icon: "users" as const }] : []),
        ],
      },
    ];
  }

  return [
    {
      items: [
        ...operate,
        ...(can(staff, ROLES.client) ? [{ href: "/cliente", label: "Mis eventos", icon: "calendar" as const }] : []),
      ],
    },
  ];
}

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff([...ROLES.manage, ...ROLES.pos, ...ROLES.client]);
  if (staff.mustChangePassword) redirect("/cuenta/contrasena");
  const groups = await navigation(staff);
  const subtitle = staff.client ? staff.client.name : staff.organization.isPlatform ? "Plataforma" : "Organizador";

  return (
    <div className="flex min-h-dvh flex-col md:flex-row print:block">
      <aside className="sidebar flex flex-col md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 print:hidden">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-base font-bold text-[var(--accent-ink)]">
            {staff.organization.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight">{staff.organization.name}</span>
            <span className="block truncate text-xs text-[var(--side-dim)]">{subtitle}</span>
          </span>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-0.5 md:overflow-y-auto md:pb-0">
          {groups.map((group, i) => (
            <div key={group.title ?? i} className="flex gap-1 md:mb-3 md:block md:space-y-0.5">
              {group.title && <p className="side-title hidden md:block">{group.title}</p>}
              {group.items.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </div>
          ))}
        </nav>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--side-border)] px-4 py-3 md:block md:p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{staff.name}</p>
            <p className="text-xs text-[var(--side-dim)]">
              {ROLE_LABEL[staff.role]}
              {staff.viewingAs ? " · Impacta" : ""}
            </p>
            <Link href="/cuenta/contrasena" className="mb-3 mt-1 hidden text-xs text-[var(--side-dim)] hover:text-[var(--side-ink)] md:block">
              Cambiar contraseña
            </Link>
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

      <main className="min-w-0 flex-1 print:p-0">
        {staff.viewingAs && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#3b5bb5]/30 bg-[#e8eefc] px-4 py-2.5 text-sm text-[#2c4489] md:px-8 print:hidden">
            <p>
              Estás dentro de <strong>{staff.viewingAs.name}</strong> como Impacta: ves y editas lo mismo que el
              organizador.
            </p>
            <form action={exitOrganizationAction}>
              <input type="hidden" name="next" value="/organizadores" />
              <button type="submit" className="rounded-md bg-white px-3 py-1 text-xs font-medium shadow-sm">
                Volver a Impacta
              </button>
            </form>
          </div>
        )}
        <div className="p-4 md:p-8 print:p-0">
          <div className="mx-auto max-w-6xl">{children}</div>
        </div>
      </main>
    </div>
  );
}
