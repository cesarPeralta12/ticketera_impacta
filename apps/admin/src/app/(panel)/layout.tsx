import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { prisma } from "@ticketera/db";
import { signOut } from "@/lib/auth";
import { exitOrganizationAction } from "@/lib/actions/platform";
import { ROLE_LABEL } from "@/lib/labels";
import { ROLES, can, isGlobalView, requireStaff, type Staff } from "@/lib/session";

type NavItem = { href: string; label: string; badge?: number };
type NavGroup = { title?: string; items: NavItem[] };

/** El menú depende de quién entra: IMPACTA (general o dentro de un organizador), un organizador o su personal. */
async function navigation(staff: Staff): Promise<NavGroup[]> {
  const operate: NavItem[] = [
    ...(can(staff, ROLES.pos) ? [{ href: "/boleteria", label: "Boletería" }] : []),
    ...(can(staff, ROLES.access) ? [{ href: "/puerta", label: "Control de acceso" }] : []),
  ];

  if (isGlobalView(staff)) {
    const pending = await prisma.event.count({ where: { status: "PENDING_REVIEW" } });
    return [
      {
        title: "Plataforma",
        items: [
          { href: "/", label: "Resumen general" },
          { href: "/organizadores", label: "Organizadores" },
          { href: "/aprobaciones", label: "Aprobaciones", badge: pending },
          { href: "/ordenes", label: "Ventas" },
          { href: "/ingresos", label: "Ingresos en puerta" },
        ],
      },
      {
        title: "Eventos de Impacta",
        items: [
          { href: "/eventos", label: "Eventos" },
          { href: "/clientes", label: "Clientes" },
          { href: "/recintos", label: "Recintos" },
          ...operate,
        ],
      },
      { title: "Cuentas", items: [{ href: "/usuarios", label: "Usuarios" }] },
    ];
  }

  if (can(staff, ROLES.manage)) {
    return [
      {
        items: [
          { href: "/", label: "Resumen" },
          { href: "/eventos", label: "Eventos" },
          { href: "/recintos", label: "Recintos" },
          { href: "/ordenes", label: "Ventas" },
          { href: "/ingresos", label: "Ingresos en puerta" },
          ...operate,
          // Las cuentas de un organizador las crea IMPACTA (al entrar en él).
          ...(staff.platform ? [{ href: "/usuarios", label: "Usuarios" }] : []),
        ],
      },
    ];
  }

  return [{ items: [...operate, ...(can(staff, ROLES.client) ? [{ href: "/cliente", label: "Mis eventos" }] : [])] }];
}

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff([...ROLES.manage, ...ROLES.pos, ...ROLES.client]);
  if (staff.mustChangePassword) redirect("/cuenta/contrasena");
  const groups = await navigation(staff);
  const subtitle = staff.client
    ? staff.client.name
    : staff.organization.isPlatform
      ? "Plataforma"
      : "Organizador";

  return (
    <div className="flex min-h-dvh flex-col md:flex-row print:block">
      <aside className="flex flex-col border-b border-[var(--border)] bg-[var(--surface)] md:w-60 md:border-b-0 md:border-r print:hidden">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] font-mono text-xs font-medium text-[var(--accent-ink)]">
            {staff.organization.name.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <span className="block text-[15px] font-semibold leading-tight tracking-tight">{staff.organization.name}</span>
            <span className="eyebrow block">{subtitle}</span>
          </span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {groups.map((group, i) => (
            <div key={group.title ?? i} className="flex gap-1 md:flex-col">
              {group.title && <p className="eyebrow hidden px-2.5 pb-1 pt-3 md:block">{group.title}</p>}
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center justify-between gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                >
                  {item.label}
                  {item.badge ? (
                    <span className="rounded-full bg-[var(--warn)] px-1.5 text-[10px] font-semibold text-white">{item.badge}</span>
                  ) : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-[var(--border)] px-5 py-4 md:block">
          <p className="text-sm font-medium">{staff.name}</p>
          <p className="eyebrow">
            {ROLE_LABEL[staff.role]}
            {staff.viewingAs ? " · Impacta" : ""}
          </p>
          <Link href="/cuenta/contrasena" className="mt-2 block text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]">
            Cambiar contraseña
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="btn mt-3 w-full text-xs">
              Salir
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 print:p-0">
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
