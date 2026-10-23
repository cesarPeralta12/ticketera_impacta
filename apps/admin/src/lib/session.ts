import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EventCategory, clientAccessOpen, prisma, type StaffRole } from "@ticketera/db";
import { auth } from "./auth";

/** Quién puede hacer qué en el panel (dentro de su organización). */
export const ROLES = {
  /** Configurar eventos, recintos y precios; ver ventas y reportes de la organización. */
  manage: ["OWNER", "ADMIN"],
  /** Crear y desactivar cuentas del panel. */
  users: ["OWNER", "ADMIN"],
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
  /** El portero trabaja solo con la app móvil: el panel web no es para su rol. */
  OPERATOR: "/login",
  CASHIER: "/boleteria",
  CLIENT: "/cliente",
};

/** Organizador en el que está trabajando un administrador de IMPACTA ("Entrar como"). */
export const VIEW_AS_COOKIE = "impacta-ver-como";

/** Vista previa dentro de un organizador: el panel como lo ve una de sus cuentas, sin poder cambiar nada. */
export const PREVIEW_ROLE_COOKIE = "impacta-ver-como-rol";
export const PREVIEW_ROLES = ["ADMIN", "CASHIER"] as const satisfies StaffRole[];
export type PreviewRole = (typeof PREVIEW_ROLES)[number];
export const PREVIEW_LABEL: Record<PreviewRole, string> = { ADMIN: "el organizador", CASHIER: "un cajero" };

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
      user: { select: { name: true, email: true, mustChangePassword: true, sessionVersion: true } },
      organization: true,
      client: true,
    },
  });
  if (!membership) return null;
  // Sesión cerrada desde la cuenta (cambió la contraseña o "cerrar todas las sesiones").
  if (membership.user.sessionVersion !== session.user.sessionVersion) return null;
  const home = membership.organization;
  const platform = home.isPlatform && (membership.role === "OWNER" || membership.role === "ADMIN");
  // Un organizador suspendido pierde el acceso en la siguiente acción, aunque tenga sesión.
  if (!platform && home.status !== "ACTIVE") return null;

  let organization = home;
  let viewingAs: typeof home | null = null;
  let preview: PreviewRole | null = null;
  if (platform) {
    const jar = await cookies();
    const viewId = jar.get(VIEW_AS_COOKIE)?.value;
    if (viewId && viewId !== home.id) {
      const target = await prisma.organization.findUnique({ where: { id: viewId } });
      if (target && !target.isPlatform) {
        organization = target;
        viewingAs = target;
        preview = PREVIEW_ROLES.find((r) => r === jar.get(PREVIEW_ROLE_COOKIE)?.value) ?? null;
      }
    }
  }

  return {
    id: session.user.id,
    name: membership.user.name,
    email: membership.user.email,
    // En la vista previa, el rol de la cuenta que se está mirando (el menú y los permisos son los suyos).
    role: preview ?? membership.role,
    mustChangePassword: membership.user.mustChangePassword,
    organization,
    /** Su propia organización (para IMPACTA, aunque esté viendo un organizador). */
    home,
    platform: platform && !preview,
    /** El organizador en el que entró un administrador de IMPACTA, o null. */
    viewingAs,
    /** IMPACTA mirando el panel como lo ve una cuenta del organizador (siempre de solo lectura), o null. */
    preview,
    /** Solo para el rol CLIENT. */
    client: viewingAs ? null : membership.client,
    /**
     * Solo lectura: las cuentas de los organizadores y de los clientes ven todo lo suyo (eventos, ventas,
     * ingresos, reportes) pero no cambian nada; crear y modificar es solo de IMPACTA (también cuando entra en
     * un organizador). El personal de operación (cajero y portero) sigue vendiendo, cobrando y leyendo QR.
     */
    readOnly: preview !== null || (!platform && (membership.role === "OWNER" || membership.role === "ADMIN" || membership.role === "CLIENT")),
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

export const READ_ONLY_MESSAGE = "Tu cuenta es de solo lectura: los cambios los hace iPass.";

/** Una cuenta de solo lectura intentó cambiar algo (la interfaz no lo ofrece: llegó por otro lado). */
export class ReadOnlyError extends Error {
  constructor() {
    super(READ_ONLY_MESSAGE);
  }
}

/**
 * Para toda server action que crea o cambia algo: además del rol, exige que la cuenta pueda editar
 * (IMPACTA). Una cuenta de solo lectura no pasa aunque invoque la acción directamente.
 */
export async function requireEditor(allowed: StaffRole[] = ROLES.manage): Promise<Staff> {
  const staff = await requireStaff(allowed);
  if (staff.readOnly) throw new ReadOnlyError();
  return staff;
}

/** El organizador en el que se trabaja es un boliche (noches, mesas, barra). */
export const isNightlife = (staff: Staff) => staff.organization.kind === "NIGHTLIFE";

/** Categorías de evento según el organizador: un boliche solo hace noches; uno de eventos, todo menos boliche. */
export function allowedCategories(staff: Staff): EventCategory[] {
  const all = Object.values(EventCategory);
  if (staff.organization.isPlatform) return all;
  return isNightlife(staff) ? ["BOLICHE"] : all.filter((c) => c !== "BOLICHE");
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
