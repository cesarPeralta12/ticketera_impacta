import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { prisma } from "@ticketera/db";
import { GuidedTour, TourReplay, type TourStep } from "@/components/guided-tour";
import { Logo } from "@/components/logo";
import { NavLink, type NavIcon } from "@/components/nav-link";
import { PageTransition } from "@/components/page-transition";
import { PasswordNotice } from "@/components/password-notice";
import { ReadOnlyProvider } from "@/components/read-only";
import { exitOrganizationAction, previewAsAction } from "@/lib/actions/platform";
import { signOut } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { HOME_BY_ROLE, PREVIEW_LABEL, PREVIEW_ROLES, ROLES, can, isGlobalView, isNightlife, requireStaff, type Staff } from "@/lib/session";

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
          // Los eventos los arma iPass y se publican directo: Aprobaciones aparece solo si un organizador envió uno.
          ...(pending > 0 ? [{ href: "/aprobaciones", label: "Aprobaciones", icon: "check" as const, badge: pending }] : []),
          { href: "/ordenes", label: "Ventas", icon: "receipt" },
          { href: "/conciliacion", label: "Conciliación de cobros", icon: "check" },
          { href: "/compradores", label: "Compradores", icon: "user" },
          { href: "/ingresos", label: "Ingresos en puerta", icon: "door" },
        ],
      },
      {
        title: "Eventos de iPass",
        items: [
          { href: "/eventos", label: "Eventos", icon: "calendar" },
          { href: "/clientes", label: "Clientes", icon: "briefcase" },
          { href: "/recintos", label: "Recintos", icon: "map" },
          { href: "/promociones", label: "Promociones", icon: "tag" },
          { href: "/promotores", label: "Promotores", icon: "users" },
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
          ...(staff.platform ? [{ href: "/conciliacion", label: "Conciliación de cobros", icon: "check" as const }] : []),
          { href: "/compradores", label: "Compradores", icon: "user" },
          { href: "/ingresos", label: "Ingresos en puerta", icon: "door" },
          { href: "/promociones", label: nightlife ? "Promociones y RRPP" : "Promociones", icon: "tag" },
          { href: "/promotores", label: "Promotores", icon: "users" },
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
        // Barra: solo lee los QR de consumo de sus noches.
        ...(staff.role === "BAR" ? [{ href: "/barra", label: "Barra (QR de consumo)", icon: "glass" as const }] : []),
        // Promotor: vende con cobro por QR sus eventos y ve su comisión, nada más.
        ...(can(staff, ROLES.promoter) ? [{ href: "/promotor", label: "Vender y mi comisión", icon: "ticket" as const }] : []),
      ],
    },
  ];
}

/** Pasos del recorrido guiado: abre cada sección e ilumina lo importante (según lo que la cuenta puede hacer). */
function tourSteps(staff: Staff): TourStep[] {
  const nightlife = isNightlife(staff);
  const events = nightlife ? "Noches" : "Eventos";
  const welcome: TourStep = {
    title: "Bienvenido al panel de iPass",
    href: "/",
    target: ".stats",
    text: staff.readOnly
      ? "Este es tu resumen en vivo. Te mostramos dónde ver tus eventos, ventas e ingresos."
      : "Este es tu resumen en vivo. En unos pasos te llevamos por cada sección y te mostramos lo principal.",
    points: ["Los números se actualizan solos cada 30 segundos.", "Toca una tarjeta para ir al detalle."],
  };
  const search: TourStep = {
    title: "Buscar",
    target: 'aside input[name="q"]',
    text: "Desde cualquier pantalla encuentras lo que necesites, sin navegar.",
    points: ["Un evento por su nombre.", "Una orden o una entrada por su código (ej. 7SQYG-DMUYB).", "Un comprador por nombre, correo o carnet."],
  };
  const done: TourStep = {
    title: "¡Listo!",
    target: '[data-tour="replay"]',
    text: "Ya conoces lo principal. Para repasar, toca «Ver el recorrido» abajo del menú (en la computadora). Y en cada pantalla, el «?» junto al título explica esa parte.",
  };

  // Cajero: solo vende (boletería) y, en un boliche, descuenta consumos (barra).
  if (!can(staff, ROLES.manage)) {
    return [
      {
        title: "Bienvenido a la boletería",
        href: "/boleteria",
        target: '[data-tour="funciones-venta"]',
        text: "Aquí vendes en la puerta o en un punto de venta. Empieza eligiendo la función que estás vendiendo.",
        points: [
          "Solo aparecen las funciones con venta en puerta abierta.",
          "Elige las butacas o las cantidades y cobra en efectivo, QR o tarjeta.",
          "Imprime el ticket en térmica de 80 mm, A4 o carta: el QR es la entrada.",
        ],
      },
      ...(nightlife
        ? [
            {
              title: "Barra (consumos)",
              href: "/barra",
              text: "Para mesas, lounges y entradas con trago: lees el QR de cualquier persona de la mesa y descuentas lo que pidan.",
              points: ["El saldo es compartido por la mesa.", "Nunca queda en negativo."],
            },
          ]
        : []),
      done,
    ];
  }

  // iPass (vista general de la plataforma): organizadores, eventos propios y cuentas.
  if (isGlobalView(staff)) {
    return [
      {
        ...welcome,
        text: "Este es el resumen de toda la plataforma, en vivo: todos los organizadores juntos. En unos pasos te llevamos por cada sección.",
        points: ["Los números se actualizan solos cada 30 segundos.", "Toca una tarjeta para ir al detalle."],
      },
      {
        title: "Organizadores y boliches",
        href: "/organizadores",
        target: '[data-tour="nuevo-organizador"]',
        text: "Los clientes a los que iPass da el servicio. Cada uno tiene su panel de solo lectura: lo que se crea o cambia lo hace iPass.",
        points: [
          "Crea el usuario de un organizador de eventos o de un boliche: empieza vacío.",
          "«Entrar» abre su panel: ahí le armas recintos, eventos y precios.",
          "Suspenderlo corta su acceso y el de sus porteros al instante.",
        ],
      },
      {
        title: "Eventos de iPass",
        href: "/eventos",
        target: '[data-tour="nuevo-evento"]',
        text: "Los eventos propios de iPass o de un cliente que iPass opera. El asistente te lleva paso a paso.",
        points: [
          "Datos, lugar y fecha, entradas (modelos listos) y revisión con la vista previa.",
          "«Evento pequeño»: el acceso rápido, una sola pantalla (en la web o con entradas impresas).",
          "Dentro de cada evento: Vista previa, Importar Excel y Reporte.",
        ],
      },
      {
        title: "Clientes",
        href: "/clientes",
        target: '[data-tour="nuevo-cliente"]',
        text: "Las productoras para las que iPass gestiona eventos. Cada evento se asigna a un cliente.",
        points: ["El cliente ve sus ventas e ingresos en un espacio de solo lectura.", "Ese acceso se habilita por evento y por un tiempo."],
      },
      {
        title: "Recintos",
        href: "/recintos",
        target: '[data-tour="plantillas"]',
        text: "El lugar y su mapa: butacas, mesas, zonas de pie, puertas y zonas de acceso. Empieza desde una plantilla.",
      },
      {
        title: "Ventas",
        href: "/ordenes",
        target: '[data-tour="filtros-ventas"]',
        text: "Todas las ventas de todos los organizadores: web, boletería, invitaciones, impresas e importadas.",
        points: ["Busca por código, nombre, correo o carnet.", "Abre una orden para reenviar entradas o anularla.", "Exporta a Excel."],
      },
      {
        title: "Ingresos en puerta",
        href: "/ingresos",
        target: '[data-tour="filtros-ingresos"]',
        text: "Cada lectura de las puertas en vivo: quién entró, por dónde y a qué hora, y los rechazos con su motivo.",
      },
      {
        title: "Usuarios y porteros",
        href: "/usuarios",
        target: '[data-tour="crear-cuenta"]',
        text: "Las cuentas del equipo de iPass, cada una con su rol. Las de un organizador se crean entrando a ese organizador.",
        points: ["Dueño, administrador, cajero o portero.", "A cada portero le asignas su función y su puerta."],
      },
      {
        title: "Seguridad",
        href: "/seguridad",
        text: "Quién hizo qué, cuándo y desde dónde: ingresos fallidos, bloqueos, dispositivos nuevos y cambios en el sistema.",
      },
      search,
      done,
    ];
  }

  if (staff.readOnly) {
    return [
      welcome,
      {
        title: events,
        href: "/eventos",
        target: '[data-tour="lista-eventos"]',
        text: "Tus eventos con sus funciones, cuánto se vendió y quién entró.",
        points: ["Abre uno para ver sus pestañas: resumen, funciones y ventas.", "El reporte se imprime o se descarga."],
      },
      {
        title: "Ventas",
        href: "/ordenes",
        target: '[data-tour="filtros-ventas"]',
        text: "Todas las ventas con su estado, en vivo.",
        points: ["Busca por código, nombre, correo o carnet.", "Exporta a Excel."],
      },
      {
        title: "Ingresos en puerta",
        href: "/ingresos",
        target: '[data-tour="filtros-ingresos"]',
        text: "Cada lectura de las puertas: quién entró, por dónde y a qué hora.",
      },
      search,
      done,
    ];
  }

  return [
    welcome,
    {
      title: nightlife ? "Crear una noche" : "Crear un evento",
      href: "/eventos",
      target: '[data-tour="nuevo-evento"]',
      text: "Con este botón empieza todo. El asistente te lleva paso a paso y puedes salir y volver cuando quieras.",
      points: [
        "Datos: título, categoría, imagen y condiciones (edad, documento, vestimenta).",
        "Lugar y fecha: recinto, horarios y cuándo abre y cierra la venta online.",
        "Entradas: modelos listos (General, VIP, Mesa, Free, Preventa).",
        "Revisar con la vista previa del comprador y publicar.",
      ],
    },
    ...(!nightlife
      ? [
          {
            title: "Evento pequeño",
            href: "/eventos",
            target: '[data-tour="evento-pequeno"]',
            text: "El acceso rápido para peñas, recitales u obras chicas: todo en una sola pantalla.",
            points: [
              "Nombre, fecha, lugar y hasta 4 tipos de entrada.",
              "En la web: queda publicado y sale en «Otros eventos».",
              "Impresas: quedan lotes numerados listos para imprimir (PDF), que se activan al marcarse vendidos.",
              "Para algo grande (mapa, butacas, fases), «+ Nuevo evento» con el asistente completo.",
            ],
          },
        ]
      : []),
    {
      title: `Dentro de cada ${nightlife ? "noche" : "evento"}`,
      href: "/eventos",
      target: '[data-tour="lista-eventos"] > li:first-child',
      text: "Al abrirlo lo ves ordenado en pestañas.",
      points: [
        "Resumen: ventas, ingresos y lo que falta para publicar.",
        "Funciones: precios, retenciones, entradas impresas e ingreso en vivo.",
        "Ventas y Configuración: datos, condiciones y «Evento pequeño».",
        "Arriba: Vista previa, Importar Excel y Reporte.",
      ],
    },
    {
      title: "Recintos",
      href: "/recintos",
      target: '[data-tour="plantillas"]',
      text: "El lugar y su mapa. No empieces de cero: elige una plantilla y después cambia lo que haga falta.",
      points: [
        "Plantillas: boliche, teatro, salón con mesas o aire libre.",
        "Editor: butacas, mesas con sillas, zonas de pie y lounges.",
        "Sube el plano del local de fondo para calcarlo.",
        "Puertas de entrada y salida y zonas de acceso (VIP).",
      ],
    },
    {
      title: "Ventas",
      href: "/ordenes",
      target: '[data-tour="filtros-ventas"]',
      text: "Todas las ventas juntas: web, boletería, invitaciones, impresas e importadas.",
      points: ["Filtra por estado o busca por código, nombre, correo o carnet.", "Abre una orden para reenviar entradas o anularla.", "Exporta a Excel."],
    },
    {
      title: "Ingresos en puerta",
      href: "/ingresos",
      target: '[data-tour="filtros-ingresos"]',
      text: "Cada lectura de las puertas en vivo.",
      points: [
        "Quién entró, por qué puerta y a qué hora.",
        "Los rechazos con su motivo (ya usada, puerta equivocada…).",
        "En cada función, «Ingreso en vivo» muestra el mapa y cuántos hay adentro.",
      ],
    },
    {
      title: nightlife ? "Promociones y RRPP" : "Promociones",
      href: "/promociones",
      target: '[data-tour="crear-codigo"]',
      text: "Códigos de descuento para campañas, convenios o promotores.",
      points: ["Porcentaje o monto fijo, con cupo y fechas.", "Asigna un promotor (RRPP) y su comisión."],
    },
    ...(can(staff, ROLES.pos)
      ? [
          {
            title: "Boletería",
            href: "/boleteria",
            target: '[data-tour="funciones-venta"]',
            text: "Para vender en la puerta o en un punto de venta.",
            points: ["Elige la función, las butacas o cantidades y cobra (efectivo, QR o tarjeta).", "Imprime el ticket en térmica de 80 mm, A4 o carta."],
          },
        ]
      : []),
    ...(staff.platform
      ? [
          {
            title: "Usuarios y porteros",
            href: "/usuarios",
            target: '[data-tour="crear-cuenta"]',
            text: "Las cuentas del equipo, cada una con su rol.",
            points: ["Dueño, administrador, cajero, portero o cliente (solo lectura).", "A cada portero le asignas su función y su puerta."],
          },
        ]
      : []),
    search,
    done,
  ];
}

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff([...ROLES.manage, ...ROLES.pos, ...ROLES.client, ...ROLES.promoter, ...ROLES.bar]);
  if (staff.mustChangePassword) redirect("/cuenta/contrasena");
  const groups = await navigation(staff);
  // Debajo del logo: de quién es el panel (en la plataforma no hace falta, el menú ya dice "Plataforma").
  const subtitle = staff.client
    ? staff.client.name
    : staff.organization.isPlatform
      ? null
      : isNightlife(staff)
        ? "Boliche"
        : "Organizador de eventos";

  return (
    <div className="flex min-h-dvh flex-col md:flex-row print:block">
      <aside className="sidebar flex flex-col md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 print:hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-5 md:block">
          <Link href={HOME_BY_ROLE[staff.role]} aria-label="iPass, ir al inicio" className="block w-fit">
            <Logo negative className="h-8 w-auto md:h-9" />
          </Link>
          {subtitle && (
            <span className="min-w-0 text-right md:mt-3 md:block md:text-left">
              {!staff.organization.isPlatform && (
                <span className="block truncate text-sm font-semibold leading-tight">{staff.organization.name}</span>
              )}
              <span className="side-title block truncate !p-0">{subtitle}</span>
            </span>
          )}
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
              {staff.readOnly && staff.role !== "CASHIER" ? "Solo lectura" : ROLE_LABEL[staff.role]}
              {staff.viewingAs ? " · iPass" : ""}
            </p>
            <Link href="/cuenta/contrasena" className="mt-1 hidden text-xs text-[var(--side-dim)] hover:text-[var(--side-ink)] md:block">
              Cambiar contraseña
            </Link>
            {can(staff, ROLES.pos) && (
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
        {staff.viewingAs && staff.preview && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--highlight)] bg-[var(--highlight-soft)] px-4 py-2.5 text-sm text-[var(--ink)] md:px-8 print:hidden">
            <p>
              <strong>Vista previa:</strong> así ve el panel {PREVIEW_LABEL[staff.preview]} de{" "}
              <strong>{staff.viewingAs.name}</strong>. No se puede cambiar nada.
            </p>
            <div className="flex flex-wrap gap-2">
              {PREVIEW_ROLES.filter((r) => r !== staff.preview).map((r) => (
                <form key={r} action={previewAsAction}>
                  <input type="hidden" name="role" value={r} />
                  <button type="submit" className="rounded-md bg-white px-3 py-1 text-xs font-medium shadow-sm">
                    Ver como {PREVIEW_LABEL[r]}
                  </button>
                </form>
              ))}
              <form action={previewAsAction}>
                <button type="submit" className="rounded-md bg-[var(--ipass-navy)] px-3 py-1 text-xs font-medium text-white shadow-sm">
                  Salir de la vista previa
                </button>
              </form>
            </div>
          </div>
        )}
        {staff.viewingAs && !staff.preview && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--info)]/30 bg-[var(--info-soft)] px-4 py-2.5 text-sm text-[var(--info)] md:px-8 print:hidden">
            <p>
              Estás dentro de <strong>{staff.viewingAs.name}</strong> como iPass: aquí creas y editas lo que el
              organizador ve (su cuenta es de solo lectura).
            </p>
            <div className="flex flex-wrap gap-2">
              {PREVIEW_ROLES.map((r) => (
                <form key={r} action={previewAsAction}>
                  <input type="hidden" name="role" value={r} />
                  <button type="submit" className="rounded-md bg-white px-3 py-1 text-xs font-medium shadow-sm">
                    Ver como {PREVIEW_LABEL[r]}
                  </button>
                </form>
              ))}
              <form action={exitOrganizationAction}>
                <input type="hidden" name="next" value="/organizadores" />
                <button type="submit" className="rounded-md bg-white px-3 py-1 text-xs font-medium shadow-sm">
                  Volver a iPass
                </button>
              </form>
            </div>
          </div>
        )}
        {staff.readOnly && staff.role !== "CASHIER" && (
          <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-sm text-[var(--ink-muted)] md:px-8 print:hidden">
            <strong className="text-[var(--ink)]">Cuenta de solo lectura.</strong> Ves en vivo tus eventos, ventas,
            compradores e ingresos; los cambios (eventos, precios, recintos, promociones, cuentas) los hace iPass.
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
          {can(staff, ROLES.pos) && <GuidedTour steps={tourSteps(staff)} />}
        </div>
      </main>
    </div>
  );
}
