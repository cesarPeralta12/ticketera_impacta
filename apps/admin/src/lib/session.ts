import { redirect } from "next/navigation";
import { prisma, type StaffRole } from "@ticketera/db";
import { auth } from "./auth";

/** Quién puede hacer qué en el panel. */
export const ROLES = {
  /** Configurar eventos, recintos, precios; ver órdenes y reportes. */
  manage: ["OWNER", "ADMIN"],
  /** Crear y desactivar cuentas del panel. */
  users: ["OWNER", "ADMIN"],
  /** Validar entradas en puerta. */
  access: ["OWNER", "ADMIN", "OPERATOR"],
} satisfies Record<string, StaffRole[]>;

/**
 * Usuario del panel que hace la request, verificado contra la base en cada llamada.
 * La sesión es un JWT que no se puede revocar; esta consulta sí: una cuenta desactivada
 * o con el rol cambiado pierde el acceso en la siguiente acción, sin esperar a que expire.
 *
 * Toda página y server action del panel debe pasar por aquí: el proxy solo redirige,
 * no protege las server actions, que se pueden invocar directamente.
 */
export async function requireStaff(allowed: StaffRole[] = ROLES.manage) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const membership = await prisma.membership.findFirst({
    where: { userId: session.user.id, organizationId: session.user.organizationId, user: { active: true } },
    include: { user: { select: { name: true, email: true } }, organization: true },
  });
  if (!membership) redirect("/login");
  if (!allowed.includes(membership.role)) redirect(membership.role === "OPERATOR" ? "/acceso" : "/");

  return {
    id: session.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    organization: membership.organization,
  };
}
