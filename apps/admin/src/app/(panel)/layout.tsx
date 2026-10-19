import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { prisma } from "@ticketera/db";
import { GuidedTour, TourReplay, type TourStep } from "@/components/guided-tour";
import { NavLink, type NavIcon } from "@/components/nav-link";
import { PageTransition } from "@/components/page-transition";
import { PasswordNotice } from "@/components/password-notice";
import { ReadOnlyProvider } from "@/components/read-only";
import { exitOrganizationAction } from "@/lib/actions/platform";
import { signOut } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { ROLES, can, isGlobalView, isNightlife, requireStaff, type Staff } from "@/lib/session";

type NavItem = { href: string; label: string; icon: NavIcon; badge?: number };
type NavGroup = { title?: string; items: NavItem[] };

/** El menú depende de quién entra: IMPACTA (general o dentro de un organizador), un organizador o su personal. */
async function navigation(staff: Staff): Promise<NavGroup[]> {
  // El control de acceso se hace con la app móvil de puerta: el panel no tiene pantalla de lectura.
  // La Barra es de los boliches (e IMPACTA, que puede operar uno).
  const nightlife = isNightlife(staff);
  const operate: NavItem[] = can(staff, ROLES.pos)
    ? [
        { href: "/boleteria", label: "Boletería", icon: "ticket" },
        ...(nightlife || isGlobalView(staff) ? [{ href: "/barra", label: "Barra (consumos)", icon: "glass" as const }] : []),
      ]
    : [];

  if (isGlobalView(staff)) {
    const pending = await prisma.event.count({ where: { status: "PENDING_REVIEW" } });
    return [
      {
        title: "Plataforma",
        items: [
          { href: "/", label: "Resumen general", icon: "home" },
          { href: "/organizadores", label: "Organizadores", icon: "briefcase" },
          { href: "/organizadores?tipo=boliche", label: "Boliches", icon: "glass" },
          { href: "/aprobaciones", label: "Aprobaciones", icon: "check", badge: pending },
          { href: "/ordenes", label: "Ventas", icon: "receipt" },
          { href: "/compradores", label: "Compradores", icon: "user" },
          { href: "/ingresos", label: "Ingresos en puerta", icon: "door" },
        ],
      },
      {
        title: "Eventos de Impacta",
        items: [
          { href: "/eventos", label: "Eventos", icon: "calendar" },
          { href: "/clientes", label: "Clientes", icon: "briefcase" },
          { href: "/recintos", label: "Recintos", icon: "map" },
          { href: "/promociones", label: "Promociones", icon: "tag" },
          ...operate,
        ],
      },
      {
        title: "Cuentas",
        items: [
          { href: "/usuarios", label: "Usuarios y porteros", icon: "users" },
          { href: "/seguridad", label: "Seguridad", icon: "shield" },
        ],
      },
    ];
  }

  if (can(staff, ROLES.manage)) {
    return [
      {
        items: [
          { href: "/", label: "Resumen", icon: "home" },
          { href: "/eventos", label: nightlife ? "Noches" : "Eventos", icon: "calendar" },
          { href: "/recintos", label: "Recintos", icon: "map" },
          { href: "/ordenes", label: "Ventas", icon: "receipt" },
          { href: "/compradores", label: "Compradores", icon: "user" },
          { href: "/ingresos", label: "Ingresos en puerta", icon: "door" },
          { href: "/promociones", label: nightlife ? "Promociones y RRPP" : "Promociones", icon: "tag" },
          ...operate,
          { href: "/seguridad", label: "Seguridad", icon: "shield" },
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

/** Pasos del recorrido guiado de la primera vez (según lo que la cuenta puede hacer). */
function tourSteps(staff: Staff): TourStep[] {
  const nightlife = isNightlife(staff);
  return [
    {
      title: "Bienvenido al panel de Impacta",
      text: staff.readOnly
        ? "Aquí ves en vivo tus eventos, ventas, compradores e ingresos. Te mostramos dónde está cada cosa en 4 pasos."
        : "Desde aquí armas tus eventos, vendes en boletería y controlas la puerta. Te mostramos lo principal en unos pasos.",
    },
    {
      title: nightlife ? "Noches" : "Eventos",
      href: "/eventos",
      text: staff.readOnly
        ? "Cada evento con sus funciones, cuánto se vendió y quién entró."
        : "Crea un evento y el asistente te lleva paso a paso: lugar y fecha, entradas (con modelos), revisión con la vista previa del comprador y publicar. Para eventos chicos con entradas impresas, usa '+ Evento pequeño'.",
    },
    {
      title: "Recintos",
      href: "/recintos",
      text: "El lugar y su mapa: zonas de pie, butacas, mesas con sillas, lounges, puertas y zonas de acceso. Empieza desde una plantilla (boliche, teatro, salón o aire libre).",
    },
    { title: "Ventas", href: "/ordenes", text: "Todas las ventas (web, boletería, invitaciones, impresas e importadas), con su estado. Se exportan a Excel." },
    { title: "Ingresos en puerta", href: "/ingresos", text: "Cada lectura de las puertas en vivo: quién entró, por dónde y los rechazos." },
    {
      title: "Buscar",
      target: 'aside input[name="q"]',
      text: "Arriba del menú buscas cualquier cosa: un evento, una orden o una entrada por su código, o un comprador por nombre, correo o carnet.",
    },
  ];
}

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff([...ROLES.manage, ...ROLES.pos, ...ROLES.client]);
  if (staff.mustChangePassword) redirect("/cuenta/contrasena");
  const groups = await navigation(staff);
  const subtitle = staff.client
    ? staff.client.name
    : staff.organization.isPlatform
      ? "Plataforma"
      : isNightlife(staff)
        ? "Boliche"
        : "Organizador de eventos";

  return (
    <div className="flex min-h-dvh flex-col md:flex-row print:block">
      <aside className="sidebar flex flex-col md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 print:hidden">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="brand-tile flex h-9 w-9 items-center justify-center rounded-lg text-base font-bold">
            {staff.organization.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight">{staff.organization.name}</span>
            <span className="block truncate text-xs text-[var(--side-dim)]">{subtitle}</span>
          </span>
        </div>

        {can(staff, ROLES.manage) && (
          <form action="/buscar" role="search" className="px-3 pb-3">
            <input
              name="q"
              aria-label="Buscar en el panel"
              placeholder="Buscar evento, orden, código…"
              className="w-full rounded-md border border-[var(--side-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--side-ink)] placeholder:text-[var(--side-dim)] focus:border-[var(--accent)] focus:outline-none"
            />
          </form>
        )}
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
              {staff.readOnly ? "Solo lectura" : ROLE_LABEL[staff.role]}
              {staff.viewingAs ? " · Impacta" : ""}
            </p>
            <Link href="/cuenta/contrasena" className="mt-1 hidden text-xs text-[var(--side-dim)] hover:text-[var(--side-ink)] md:block">
              Cambiar contraseña
            </Link>
            {can(staff, ROLES.manage) && (
              <span className="mb-3 mt-1 block">
                <TourReplay />
              </span>
            )}
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
              Estás dentro de <strong>{staff.viewingAs.name}</strong> como Impacta: aquí creas y editas lo que el
              organizador ve (su cuenta es de solo lectura).
            </p>
            <form action={exitOrganizationAction}>
              <input type="hidden" name="next" value="/organizadores" />
              <button type="submit" className="rounded-md bg-white px-3 py-1 text-xs font-medium shadow-sm">
                Volver a Impacta
              </button>
            </form>
          </div>
        )}
        {staff.readOnly && (
          <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-sm text-[var(--ink-muted)] md:px-8 print:hidden">
            <strong className="text-[var(--ink)]">Cuenta de solo lectura.</strong> Ves en vivo tus eventos, ventas,
            compradores e ingresos; los cambios (eventos, precios, recintos, promociones, cuentas) los hace Impacta.
          </div>
        )}
        <Suspense fallback={null}>
          <PasswordNotice />
        </Suspense>
        <div className="p-4 md:p-8 print:p-0">
          <ReadOnlyProvider value={staff.readOnly}>
            <div className="mx-auto max-w-6xl">
              <PageTransition>{children}</PageTransition>
            </div>
          </ReadOnlyProvider>
          {can(staff, ROLES.manage) && <GuidedTour steps={tourSteps(staff)} />}
        </div>
      </main>
    </div>
  );
}
