/**
 * Qué puede vender cada cuenta de venta. Un cajero vende todo lo de su organización (como siempre) o, si está en
 * "solo lo asignado", únicamente los eventos y funciones que tiene asignados (con vigencia opcional). Un promotor
 * y la barra siempre trabajan solo con lo asignado. Lo controla el servidor: la boletería, la venta del promotor y la barra lo
 * verifican, no solo la pantalla.
 */
import { prisma } from "../client";
import type { SalesScope } from "../generated/prisma/client";
import { DomainError, type Db } from "./shared";

/** Medios de cobro de boletería (el cajero los declara; ver sellAtBoxOffice). */
export const POS_METHODS = ["EFECTIVO", "QR", "TARJETA"] as const;
export type PosMethod = (typeof POS_METHODS)[number];

/** Lo que una cuenta puede vender: todo, o los eventos completos y las funciones sueltas que tiene asignados. */
export type SalesAccess = { all: true; posMethods: string[] } | { all: false; eventIds: Set<string>; sessionIds: Set<string>; posMethods: string[] };

const NONE: SalesAccess = { all: false, eventIds: new Set(), sessionIds: new Set(), posMethods: [] };

/** Una asignación vale si está activa y dentro de su vigencia. */
export const assignmentLive = (now: Date) => ({
  active: true,
  AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
});

/**
 * Qué puede vender `userId` en la organización. Los administradores (y iPass, también dentro de un organizador)
 * venden todo; un cajero, según su alcance; un promotor, solo lo asignado.
 */
export async function salesAccess(db: Db, userId: string, organizationId: string, now = new Date()): Promise<SalesAccess> {
  const memberships = await db.membership.findMany({
    where: { userId, user: { active: true } },
    select: { organizationId: true, role: true, salesScope: true, posMethods: true, organization: { select: { isPlatform: true } } },
  });
  if (memberships.some((m) => m.organization.isPlatform && (m.role === "OWNER" || m.role === "ADMIN"))) return { all: true, posMethods: [] };
  const membership = memberships.find((m) => m.organizationId === organizationId);
  if (!membership) return NONE;
  if (membership.role === "OWNER" || membership.role === "ADMIN") return { all: true, posMethods: [] };
  const restricted = membership.role === "PROMOTER" || membership.role === "BAR" || (membership.role === "CASHIER" && membership.salesScope === "ASSIGNED");
  if (!restricted) return { all: true, posMethods: membership.posMethods };
  const assignments = await db.salesAssignment.findMany({
    where: { userId, event: { organizationId }, ...assignmentLive(now) },
    select: { eventId: true, sessionId: true },
  });
  return {
    all: false,
    eventIds: new Set(assignments.filter((a) => !a.sessionId).map((a) => a.eventId)),
    sessionIds: new Set(assignments.flatMap((a) => (a.sessionId ? [a.sessionId] : []))),
    posMethods: membership.posMethods,
  };
}

export const canSellSession = (access: SalesAccess, session: { id: string; eventId: string }) =>
  access.all || access.eventIds.has(session.eventId) || access.sessionIds.has(session.id);

/** Filtro de funciones (Prisma) con lo que la cuenta puede vender: para listarlas sin traer las ajenas. */
export function sellableSessionsWhere(access: SalesAccess) {
  if (access.all) return {};
  return { OR: [{ eventId: { in: [...access.eventIds] } }, { id: { in: [...access.sessionIds] } }] };
}

/** La venta (o el cobro en barra) se rechaza si la función no está asignada a la cuenta. */
export async function assertCanSell(db: Db, input: { userId: string; organizationId: string; session: { id: string; eventId: string }; now?: Date }) {
  const access = await salesAccess(db, input.userId, input.organizationId, input.now);
  if (!canSellSession(access, input.session)) {
    throw new DomainError("NOT_ALLOWED", "No tienes asignada esta función: pídele a iPass que te la asigne.");
  }
  return access;
}

/** ¿La cuenta puede cobrar con este método en boletería? (lista vacía = todos). */
export function methodAllowed(access: SalesAccess, method: string) {
  return access.posMethods.length === 0 || access.posMethods.includes(method);
}

// ───────────────────────── Configuración (panel) ─────────────────────────

/** Las asignaciones de una cuenta en la organización, con su evento y su función. */
export async function listSalesAssignments(userId: string, organizationId: string) {
  return prisma.salesAssignment.findMany({
    where: { userId, event: { organizationId } },
    orderBy: [{ event: { title: "asc" } }, { session: { startsAt: "asc" } }],
    include: {
      event: { select: { id: true, title: true } },
      session: { select: { id: true, startsAt: true, venue: { select: { name: true, timezone: true } } } },
    },
  });
}

/**
 * Asigna un evento completo (sin `sessionIds`) o algunas de sus funciones. Reemplaza lo que la cuenta tenía de ese
 * evento: así el formulario es "lo que marques es lo que vende".
 */
export async function setSalesAssignment(
  db: Db,
  input: { organizationId: string; userId: string; eventId: string; sessionIds?: string[]; startsAt?: Date | null; endsAt?: Date | null },
) {
  const event = await db.event.findFirst({
    where: { id: input.eventId, organizationId: input.organizationId },
    select: { id: true, sessions: { where: { cancelledAt: null }, select: { id: true } } },
  });
  if (!event) throw new DomainError("NOT_FOUND", "Evento no encontrado.");
  const valid = new Set(event.sessions.map((s) => s.id));
  const picked = [...new Set(input.sessionIds ?? [])].filter((id) => valid.has(id));
  if (input.sessionIds && input.sessionIds.length > 0 && picked.length === 0) throw new DomainError("INVALID_ITEMS", "Elige funciones de ese evento.");
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw new DomainError("INVALID_ITEMS", "La vigencia tiene que terminar después de empezar.");
  // Todas las funciones marcadas = el evento completo (también las funciones que se agreguen después).
  const whole = picked.length === 0 || picked.length === valid.size;
  await db.salesAssignment.deleteMany({ where: { userId: input.userId, eventId: event.id } });
  const window = { startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null };
  if (whole) await db.salesAssignment.create({ data: { userId: input.userId, eventId: event.id, ...window } });
  else await db.salesAssignment.createMany({ data: picked.map((sessionId) => ({ userId: input.userId, eventId: event.id, sessionId, ...window })) });
  return { whole, sessions: whole ? valid.size : picked.length };
}

/**
 * Suma una función a lo que vende una cuenta (desde la pantalla de la función), sin tocar lo demás que ya tiene. Si ya
 * vende el evento completo o esa función, no hace nada (o la vuelve a activar).
 */
export async function addSessionSeller(input: { organizationId: string; userId: string; sessionId: string }) {
  const session = await prisma.eventSession.findFirst({ where: { id: input.sessionId, event: { organizationId: input.organizationId } }, select: { id: true, eventId: true } });
  const membership = await prisma.membership.findFirst({ where: { userId: input.userId, organizationId: input.organizationId, role: { in: ["CASHIER", "PROMOTER", "BAR"] } } });
  if (!session || !membership) throw new DomainError("NOT_FOUND", "Función o cuenta no encontrada.");
  const existing = await prisma.salesAssignment.findFirst({
    where: { userId: input.userId, eventId: session.eventId, OR: [{ sessionId: null }, { sessionId: session.id }] },
  });
  if (existing) return existing.active ? existing : prisma.salesAssignment.update({ where: { id: existing.id }, data: { active: true } });
  return prisma.salesAssignment.create({ data: { userId: input.userId, eventId: session.eventId, sessionId: session.id } });
}

export async function removeSalesAssignment(organizationId: string, assignmentId: string) {
  const { count } = await prisma.salesAssignment.deleteMany({ where: { id: assignmentId, event: { organizationId } } });
  return count > 0;
}

export async function toggleSalesAssignment(organizationId: string, assignmentId: string) {
  const assignment = await prisma.salesAssignment.findFirst({ where: { id: assignmentId, event: { organizationId } } });
  if (!assignment) return null;
  return prisma.salesAssignment.update({ where: { id: assignment.id }, data: { active: !assignment.active } });
}

/** Cambia el alcance de un cajero (todo o solo lo asignado) y los métodos de cobro que puede usar. */
export async function updateSalesSettings(input: { organizationId: string; userId: string; salesScope?: SalesScope; posMethods?: string[] }) {
  const membership = await prisma.membership.findFirst({ where: { userId: input.userId, organizationId: input.organizationId } });
  if (!membership || (membership.role !== "CASHIER" && membership.role !== "PROMOTER" && membership.role !== "BAR")) throw new DomainError("NOT_FOUND", "Cuenta de venta no encontrada.");
  const methods = input.posMethods?.filter((m) => (POS_METHODS as readonly string[]).includes(m));
  return prisma.membership.update({
    where: { id: membership.id },
    data: {
      ...(input.salesScope && membership.role === "CASHIER" ? { salesScope: input.salesScope } : {}),
      // Todos marcados se guarda como "todos" (vacío): un método nuevo no queda bloqueado sin querer.
      ...(methods ? { posMethods: methods.length === POS_METHODS.length ? [] : methods } : {}),
    },
  });
}

/**
 * Quién puede vender una función: los cajeros que venden todo, y los cajeros y promotores que la tienen asignada (la
 * función o su evento completo), con su vigencia.
 */
export async function sessionSellers(session: { id: string; eventId: string }, organizationId: string) {
  const [allScope, assigned] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId, role: "CASHIER", salesScope: "ALL", user: { active: true } },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.salesAssignment.findMany({
      where: { OR: [{ sessionId: session.id }, { eventId: session.eventId, sessionId: null }], event: { organizationId } },
      include: { user: { select: { id: true, name: true, email: true, active: true, memberships: { where: { organizationId }, select: { role: true } } } } },
    }),
  ]);
  return {
    allScope: allScope.map((m) => m.user),
    assigned: assigned.map((a) => ({ ...a, role: a.user.memberships[0]?.role ?? null })),
  };
}
