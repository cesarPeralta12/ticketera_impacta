import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clientAccessOpen, prisma, type StaffRole } from "@ticketera/db";
import { auth } from "./auth";

/** Quién puede hacer qué en el panel (dentro de su organización). */
export const ROLES = {
  /** Configurar eventos, recintos y precios; ver ventas y reportes de la organización. */
  manage: ["OWNER", "ADMIN"],
  /** Validar entradas en puerta. */
  access: ["OWNER", "ADMIN", "OPERATOR"],
  /** Vender en boletería. */
  pos: ["OWNER", "ADMIN", "CASHIER"],
  /** Espacio temporal del cliente (eventos que IMPACTA opera para él). */
  client: ["CLIENT"],
  /** Cualquier cuenta del panel (cambiar su contraseña). */
  any: ["OWNER", "ADMIN", "OPERATOR", "CASHIER", "CLIENT"],
} satisfies Record<string, StaffRole[]>;

/** Pantalla de inicio de cada rol: cada uno ve solo lo que necesita para su trabajo. */
export const HOME_BY_ROLE: Record<StaffRole, string> = {
  OWNER: "/",
  ADMIN: "/",
  OPERATOR: "/puerta",
  CASHIER: "/boleteria",
  CLIENT: "/cliente",
};

/** Organizador en el que está trabajando un administrador de IMPACTA ("Entrar como"). */
export const VIEW_AS_COOKIE = "impacta-ver-como";

/**
 * Usuario actual verificado contra la base, o null (para route handlers que responden JSON).
 *
 * - organization: la organización en la que trabaja. Para un organizador, siempre la suya.
 *   Para IMPACTA, la suya o la del organizador en el que "entró".
 * - platform: es administrador de IMPACTA (ve y gestiona a todos los organizadores).
 */
export async function currentStaff() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const membership = await prisma.membership.findFirst({
    where: { userId: session.user.id, organizationId: session.user.organizationId, user: { active: true } },
    include: {
      user: { select: { name: true, email: true, mustChangePassword: true } },
      organization: true,
      client: true,
    },
  });
  if (!membership) return null;
  const home = membership.organization;
  const platform = home.isPlatform && (membership.role === "OWNER" || membership.role === "ADMIN");
  // Un organizador suspendido pierde el acceso en la siguiente acción, aunque tenga sesión.
  if (!platform && home.status !== "ACTIVE") return null;

  let organization = home;
  let viewingAs: typeof home | null = null;
  if (platform) {
    const viewId = (await cookies()).get(VIEW_AS_COOKIE)?.value;
    if (viewId && viewId !== home.id) {
      const target = await prisma.organization.findUnique({ where: { id: viewId } });
      if (target && !target.isPlatform) {
        organization = target;
        viewingAs = target;
      }
    }
  }

  return {
    id: session.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    mustChangePassword: membership.user.mustChangePassword,
    organization,
    /** Su propia organización (para IMPACTA, aunque esté viendo un organizador). */
    home,
    platform,
    /** El organizador en el que entró un administrador de IMPACTA, o null. */
    viewingAs,
    /** Solo para el rol CLIENT. */
    client: viewingAs ? null : membership.client,
  };
}

export type Staff = NonNullable<Awaited<ReturnType<typeof currentStaff>>>;

/**
 * Usuario del panel que hace la request, verificado contra la base en cada llamada.
 * La sesión es un JWT que no se puede revocar; esta consulta sí: una cuenta desactivada
 * o con el rol cambiado pierde el acceso en la siguiente acción, sin esperar a que expire.
 *
 * Toda página y server action del panel debe pasar por aquí: el proxy solo redirige,
 * no protege las server actions, que se pueden invocar directamente.
 */
export async function requireStaff(allowed: StaffRole[] = ROLES.manage): Promise<Staff> {
  const staff = await currentStaff();
  if (!staff) redirect("/login");
  if (!allowed.includes(staff.role)) redirect(HOME_BY_ROLE[staff.role]);
  return staff;
}

/** Solo administradores de IMPACTA: organizadores, aprobaciones, cuentas. */
export async function requirePlatform(): Promise<Staff> {
  const staff = await requireStaff(ROLES.manage);
  if (!staff.platform) redirect("/");
  return staff;
}

export const can = (staff: Staff, allowed: StaffRole[]) => allowed.includes(staff.role);

/** IMPACTA en su propia organización: las vistas generales muestran a todos los organizadores. */
export const isGlobalView = (staff: Staff) => staff.platform && !staff.viewingAs;

/** Filtro de eventos según quién mira: todos (vista general de IMPACTA) o los de la organización. */
export function eventScope(staff: Staff) {
  return isGlobalView(staff) ? {} : { organizationId: staff.organization.id };
}

/**
 * Evento que este usuario puede ver: cualquiera de la organización para IMPACTA; para un
 * cliente, solo los suyos y solo mientras su espacio temporal esté abierto.
 */
export async function visibleEvent(staff: Staff, eventId: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organizationId: staff.organization.id } });
  if (!event) return null;
  if (can(staff, ROLES.manage)) return event;
  if (staff.role === "CLIENT" && staff.client && event.clientId === staff.client.id && clientAccessOpen(event)) {
    return event;
  }
  return null;
}
