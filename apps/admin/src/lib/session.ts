import { redirect } from "next/navigation";
import { clientAccessOpen, prisma, type StaffRole } from "@ticketera/db";
import { auth } from "./auth";

/** Quién puede hacer qué en el panel. */
export const ROLES = {
  /** IMPACTA: configurar eventos, clientes, recintos, precios; ver órdenes y reportes. */
  manage: ["OWNER", "ADMIN"],
  /** Crear y desactivar cuentas del panel. */
  users: ["OWNER", "ADMIN"],
  /** Validar entradas en puerta. */
  access: ["OWNER", "ADMIN", "OPERATOR"],
  /** Vender en boletería. */
  pos: ["OWNER", "ADMIN", "CASHIER"],
  /** Espacio temporal del cliente/organizador. */
  client: ["CLIENT"],
} satisfies Record<string, StaffRole[]>;

/** Pantalla de inicio de cada rol: cada uno ve solo lo que necesita para su trabajo. */
export const HOME_BY_ROLE: Record<StaffRole, string> = {
  OWNER: "/",
  ADMIN: "/",
  OPERATOR: "/puerta",
  CASHIER: "/boleteria",
  CLIENT: "/cliente",
};

/** Usuario actual verificado contra la base, o null (para route handlers que responden JSON). */
export async function currentStaff() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const membership = await prisma.membership.findFirst({
    where: { userId: session.user.id, organizationId: session.user.organizationId, user: { active: true } },
    include: { user: { select: { name: true, email: true } }, organization: true, client: true },
  });
  if (!membership) return null;
  return {
    id: session.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    organization: membership.organization,
    /** Solo para el rol CLIENT. */
    client: membership.client,
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

export const can = (staff: Staff, allowed: StaffRole[]) => allowed.includes(staff.role);

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
