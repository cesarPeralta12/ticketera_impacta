import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/lib/auth";
import { ROLES, requireStaff } from "@/lib/session";

const roleLabel = { OWNER: "Dueño", ADMIN: "Administrador", OPERATOR: "Operador de puerta" } as const;

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff(ROLES.access);
  const canManage = (ROLES.manage as string[]).includes(staff.role);
  const canUsers = (ROLES.users as string[]).includes(staff.role);

  const nav = [
    ...(canManage
      ? [
          { href: "/", label: "Resumen" },
          { href: "/eventos", label: "Eventos" },
          { href: "/recintos", label: "Recintos" },
          { href: "/ordenes", label: "Órdenes" },
        ]
      : []),
    { href: "/acceso", label: "Control de acceso" },
    ...(canUsers ? [{ href: "/usuarios", label: "Usuarios" }] : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex flex-col border-b border-[var(--border)] bg-[var(--surface)] md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] font-mono text-xs font-medium text-[var(--accent-ink)]">
            T
          </span>
          <span>
            <span className="block text-[15px] font-semibold leading-tight tracking-tight">Tremor</span>
            <span className="eyebrow block">{staff.organization.name}</span>
          </span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-[var(--border)] px-5 py-4 md:block">
          <p className="text-sm font-medium">{staff.name}</p>
          <p className="eyebrow">{roleLabel[staff.role]}</p>
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
      <main className="flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
