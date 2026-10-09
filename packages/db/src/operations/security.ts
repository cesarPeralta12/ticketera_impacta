/**
 * Registro de seguridad y auditoría: quién hizo qué, cuándo y DESDE DÓNDE (IP, navegador o teléfono).
 *
 * Todo cambio importante y todo evento de acceso (ingresos, fallos, bloqueos, sesiones cerradas, tokens
 * reutilizados) queda en `AuditLog`. Los eventos de acceso (`auth.*`, `device.*`) se conservan 12 meses; los
 * de negocio (eventos, precios, ventas, entradas) no se borran.
 */
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../client";

/** Desde dónde se hizo: IP y navegador (web) o teléfono (app de puerta). */
export type AuditContext = {
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
};

export type AuditEntry = {
  actorType: "staff" | "customer" | "system" | "anonymous";
  actorId?: string | null;
  /** Si falta y el actor es personal del panel, se toma la organización de su cuenta. */
  organizationId?: string | null;
  /** Ej. "auth.login", "staff.create", "event.publish". */
  action: string;
  entity: string;
  entityId: string;
  data?: Prisma.InputJsonValue;
  severity?: "info" | "warn";
  context?: AuditContext;
};

/** Cuánto se conservan los eventos de acceso. */
export const SECURITY_RETENTION_DAYS = 365;
/** Prefijos de los eventos de acceso (los que caducan). */
export const SECURITY_ACTION_PREFIXES = ["auth.", "device."] as const;
/** Lo que caduca a los 12 meses: los eventos de acceso y las entregas de llaves de QR dinámico (una por cada apertura). */
const PURGE_ACTION_PREFIXES = [...SECURITY_ACTION_PREFIXES, "ticket.key_"] as const;

const clip = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null);

/**
 * Anota un evento. Si falta la organización y el actor es del panel, la resuelve por su cuenta.
 * De vez en cuando borra los eventos de acceso con más de 12 meses.
 */
export async function recordAudit(entry: AuditEntry, now = new Date()) {
  let organizationId = entry.organizationId ?? null;
  if (!organizationId && entry.actorType === "staff" && entry.actorId) {
    const membership = await prisma.membership.findFirst({
      where: { userId: entry.actorId },
      orderBy: { createdAt: "asc" },
      select: { organizationId: true },
    });
    organizationId = membership?.organizationId ?? null;
  }
  const ctx = entry.context ?? {};
  await prisma.auditLog.create({
    data: {
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      organizationId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      data: entry.data,
      severity: entry.severity ?? "info",
      ip: clip(ctx.ip, 45),
      userAgent: clip(ctx.userAgent, 300),
      deviceId: clip(ctx.deviceId, 64),
      deviceName: clip(ctx.deviceName, 80),
      createdAt: now,
    },
  });
  if (Math.random() < 0.01) await purgeOldSecurityEvents(now);
}

/** Igual que `recordAudit`, pero nunca falla: el registro no debe tumbar un ingreso ni una operación. */
export async function recordAuditSafely(entry: AuditEntry, now = new Date()) {
  try {
    await recordAudit(entry, now);
  } catch (error) {
    console.error("[auditoría] no se pudo registrar", entry.action, error);
  }
}

/** Borra los eventos de acceso con más de `SECURITY_RETENTION_DAYS`. Devuelve cuántos. */
export async function purgeOldSecurityEvents(now = new Date()) {
  const { count } = await prisma.auditLog.deleteMany({
    where: {
      OR: PURGE_ACTION_PREFIXES.map((p) => ({ action: { startsWith: p } })),
      createdAt: { lt: new Date(now.getTime() - SECURITY_RETENTION_DAYS * 24 * 3_600_000) },
    },
  });
  return count;
}

/**
 * Anota un ingreso correcto. Avisa (severidad "warn" y `newDevice`) si la cuenta ya había ingresado antes
 * pero nunca desde este navegador o teléfono.
 */
export async function recordLogin(input: { kind: "staff" | "customer"; userId: string; context?: AuditContext; now?: Date }) {
  const { kind, userId, context } = input;
  try {
    const sameDevice = context?.deviceId
      ? { deviceId: context.deviceId }
      : context?.userAgent
        ? { userAgent: clip(context.userAgent, 300) }
        : null;
    const [anyBefore, fromThisDevice] = await Promise.all([
      prisma.auditLog.count({ where: { actorId: userId, action: "auth.login" } }),
      sameDevice ? prisma.auditLog.count({ where: { actorId: userId, action: "auth.login", ...sameDevice } }) : Promise.resolve(0),
    ]);
    const newDevice = anyBefore > 0 && fromThisDevice === 0;
    await recordAudit(
      {
        actorType: kind,
        actorId: userId,
        action: "auth.login",
        entity: kind === "staff" ? "StaffUser" : "Customer",
        entityId: userId,
        severity: newDevice ? "warn" : "info",
        data: { via: context?.deviceId ? "app" : "web", newDevice },
        context,
      },
      input.now,
    );
    return { newDevice };
  } catch (error) {
    console.error("[auditoría] no se pudo registrar el ingreso", error);
    return { newDevice: false };
  }
}

export type LoginFailure = "CREDENTIALS" | "BLOCKED" | "ROLE";

/** Anota un ingreso fallido o bloqueado (por exceso de intentos). Si el correo existe, queda ligado a la cuenta. */
export async function recordLoginFailure(input: { kind: "staff" | "customer"; email: string; reason: LoginFailure; context?: AuditContext; now?: Date }) {
  const email = input.email.trim().toLowerCase().slice(0, 200);
  try {
    const account =
      input.kind === "staff"
        ? await prisma.staffUser.findUnique({ where: { email }, select: { id: true } })
        : await prisma.customer.findUnique({ where: { email }, select: { id: true } });
    await recordAudit(
      {
        actorType: account ? input.kind : "anonymous",
        actorId: account?.id ?? null,
        action: input.reason === "BLOCKED" ? "auth.blocked" : "auth.login_failed",
        entity: input.kind === "staff" ? "StaffUser" : "Customer",
        entityId: account?.id ?? email,
        severity: "warn",
        data: { email, reason: input.reason, via: input.context?.deviceId ? "app" : "web" },
        context: input.context,
      },
      input.now,
    );
  } catch (error) {
    console.error("[auditoría] no se pudo registrar el ingreso fallido", error);
  }
}

// ───────────────────────── Consultas (pantalla "Seguridad") ─────────────────────────

export type AuditScope = "security" | "changes" | "all";

export type AuditFilter = {
  /** undefined = todas las organizaciones (vista general de IMPACTA). */
  organizationId?: string;
  scope?: AuditScope;
  onlyWarnings?: boolean;
  /** Email o nombre (parte) de la cuenta que hizo la acción, o el correo con el que se intentó ingresar. */
  actor?: string;
  action?: string;
  ip?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

export type AuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  severity: string;
  entity: string;
  entityId: string;
  data: Prisma.JsonValue | null;
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
  deviceName: string | null;
  actor: { type: string; id: string | null; name: string | null; email: string | null };
};

function securityWhere(scope: AuditScope): Prisma.AuditLogWhereInput {
  const isSecurity = { OR: SECURITY_ACTION_PREFIXES.map((p) => ({ action: { startsWith: p } })) };
  if (scope === "security") return isSecurity;
  if (scope === "changes") return { NOT: isSecurity };
  return {};
}

export async function listAuditEvents(filter: AuditFilter = {}) {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const and: Prisma.AuditLogWhereInput[] = [securityWhere(filter.scope ?? "all")];

  if (filter.organizationId) and.push({ organizationId: filter.organizationId });
  if (filter.onlyWarnings) and.push({ severity: "warn" });
  if (filter.action) and.push(filter.action.endsWith(".") ? { action: { startsWith: filter.action } } : { action: filter.action });
  if (filter.ip) and.push({ ip: { startsWith: filter.ip.trim() } });
  if (filter.from || filter.to) and.push({ createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } });
  if (filter.actor?.trim()) {
    const q = filter.actor.trim();
    const [staff, customers] = await Promise.all([
      prisma.staffUser.findMany({ where: { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }, select: { id: true }, take: 50 }),
      prisma.customer.findMany({ where: { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }, select: { id: true }, take: 50 }),
    ]);
    const ids = [...staff, ...customers].map((u) => u.id);
    and.push({ OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }, { data: { path: ["email"], string_contains: q.toLowerCase() } }] });
  }

  const where: Prisma.AuditLogWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);

  const staffIds = [...new Set(rows.filter((r) => r.actorType === "staff" && r.actorId).map((r) => r.actorId!))];
  const customerIds = [...new Set(rows.filter((r) => r.actorType === "customer" && r.actorId).map((r) => r.actorId!))];
  const [staff, customers] = await Promise.all([
    prisma.staffUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true, email: true } }),
    prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, email: true } }),
  ]);
  const people = new Map([...staff, ...customers].map((p) => [p.id, p]));

  const result: AuditRow[] = rows.map((r) => {
    const person = r.actorId ? people.get(r.actorId) : undefined;
    const attempted = (r.data as { email?: string } | null)?.email ?? null;
    return {
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      severity: r.severity,
      entity: r.entity,
      entityId: r.entityId,
      data: r.data,
      ip: r.ip,
      userAgent: r.userAgent,
      deviceId: r.deviceId,
      deviceName: r.deviceName,
      actor: { type: r.actorType, id: r.actorId, name: person?.name ?? null, email: person?.email ?? attempted },
    };
  });
  return { rows: result, total, page, pageSize };
}

/** Cifras de las últimas horas para las tarjetas de la pantalla "Seguridad". */
export async function securitySummary(input: { organizationId?: string; since: Date }) {
  const base: Prisma.AuditLogWhereInput = { createdAt: { gte: input.since }, ...(input.organizationId ? { organizationId: input.organizationId } : {}) };
  const count = (where: Prisma.AuditLogWhereInput) => prisma.auditLog.count({ where: { ...base, ...where } });
  const [failedLogins, blocked, newDevices, sessionsRevoked, tokenReuse, topIps] = await Promise.all([
    count({ action: "auth.login_failed" }),
    count({ action: "auth.blocked" }),
    count({ action: "auth.login", severity: "warn" }),
    count({ action: { in: ["auth.sessions_revoked", "device.revoked"] } }),
    count({ action: "auth.refresh_reuse" }),
    prisma.auditLog.groupBy({
      by: ["ip"],
      where: { ...base, action: { in: ["auth.login_failed", "auth.blocked"] }, ip: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { ip: "desc" } },
      take: 5,
    }),
  ]);
  return {
    failedLogins,
    blocked,
    newDevices,
    sessionsRevoked,
    tokenReuse,
    topIps: topIps.map((t) => ({ ip: t.ip!, count: t._count._all })),
  };
}
