import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../client";
import type { AccessMethod, StaffRole } from "../generated/prisma/client";
import { verifyStaffCredentials } from "./accounts";

/** Roles que pueden usar la app de puerta. */
export const DOOR_APP_ROLES: StaffRole[] = ["OWNER", "ADMIN", "OPERATOR"];

/** El token de acceso es corto; la app lo renueva con su token de renovación (que rota en cada uso). */
export const ACCESS_TOKEN_MINUTES = 60;
/** Cuánto dura la sesión de un teléfono sin renovarse antes de pedir login de nuevo. */
const REFRESH_TOKEN_DAYS = 30;
/** Si el teléfono repite una renovación (la respuesta se perdió) dentro de este margen, no es un robo. */
const REFRESH_GRACE_MS = 60_000;

export const ALL_ACCESS_METHODS: AccessMethod[] = ["QR", "BARCODE", "NFC"];

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Datos de la petición de un teléfono, para la lista de dispositivos y el registro de seguridad. */
export type DeviceContext = { ip?: string; appVersion?: string; platform?: string };

export type DoorStaff = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  organizationId: string;
  /** Cuenta con contraseña temporal: tiene que cambiarla antes de usar la app. */
  mustChangePassword?: boolean;
};

/**
 * Login de la app móvil: verifica la cuenta y emite un token propio del teléfono.
 * Del token solo se guarda su hash; se puede revocar desde el panel (Usuarios).
 */
export async function startDeviceSession(input: {
  email: string;
  password: string;
  deviceId: string;
  deviceName: string;
  context?: DeviceContext;
}): Promise<{ token: string; refreshToken: string; expiresAt: Date; staff: DoorStaff; deviceTokenId: string } | { error: "CREDENTIALS" | "ROLE"; userId?: string }> {
  // verifyStaffCredentials ya rechaza cuentas desactivadas y organizadores suspendidos.
  const staff = await verifyStaffCredentials(input.email, input.password);
  if (!staff) return { error: "CREDENTIALS" };
  if (!DOOR_APP_ROLES.includes(staff.role)) return { error: "ROLE", userId: staff.id };

  const token = randomBytes(32).toString("base64url");
  const refreshToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_MINUTES * 60_000);
  const deviceId = input.deviceId.slice(0, 64);
  // Un teléfono tiene una sola sesión por cuenta: iniciar de nuevo reemplaza la anterior.
  await prisma.deviceToken.updateMany({
    where: { userId: staff.id, deviceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const created = await prisma.deviceToken.create({
    data: {
      userId: staff.id,
      tokenHash: hashToken(token),
      refreshHash: hashToken(refreshToken),
      deviceId,
      deviceName: input.deviceName.slice(0, 80) || "Teléfono",
      expiresAt,
      refreshExpiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60_000),
      ip: input.context?.ip,
      appVersion: input.context?.appVersion,
      platform: input.context?.platform,
    },
  });
  const user = await prisma.staffUser.findUniqueOrThrow({ where: { id: staff.id }, select: { mustChangePassword: true } });
  return {
    token,
    refreshToken,
    expiresAt,
    deviceTokenId: created.id,
    staff: {
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      organizationId: staff.organizationId,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

/** Usuario dueño de un token de la app, o null si no existe, venció, se revocó o la cuenta se desactivó. */
export async function authenticateDevice(
  token: string,
): Promise<(DoorStaff & { deviceId: string; deviceTokenId: string; deviceName: string }) | null> {
  if (!token) return null;
  const row = await prisma.deviceToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: { memberships: { orderBy: { createdAt: "asc" }, take: 1, include: { organization: { select: { status: true } } } } },
      },
    },
  });
  const membership = row?.user.memberships[0];
  if (!row || !membership || row.revokedAt || row.expiresAt < new Date() || !row.user.active) return null;
  // Un organizador suspendido pierde el acceso de sus teléfonos al instante, aunque el token siga vigente.
  if (membership.organization.status !== "ACTIVE") return null;
  if (!DOOR_APP_ROLES.includes(membership.role)) return null;
  // Evita escribir en cada lectura: basta con saber que estuvo activo en el último minuto.
  if (Date.now() - row.lastSeenAt.getTime() > 60_000) {
    await prisma.deviceToken.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
  }
  return {
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    role: membership.role,
    organizationId: membership.organizationId,
    mustChangePassword: row.user.mustChangePassword,
    deviceId: row.deviceId,
    deviceTokenId: row.id,
    deviceName: row.deviceName,
  };
}

export type RefreshResult =
  | { ok: true; token: string; refreshToken: string; expiresAt: Date; userId: string; deviceName: string; deviceTokenId: string }
  /** REUSED: alguien presentó un token de renovación ya usado (posible robo): la sesión del teléfono se cerró. */
  | { ok: false; reason: "INVALID" | "REUSED" | "BUSY"; userId?: string; deviceName?: string; deviceTokenId?: string };

/**
 * Renueva la sesión de un teléfono con su token de renovación y entrega un par nuevo (el anterior deja de valer).
 * Si se presenta un token de renovación que ya se había cambiado, se asume robo: se revoca esa sesión y el
 * teléfono legítimo tiene que volver a iniciar sesión.
 */
export async function refreshDeviceSession(refreshToken: string, context: DeviceContext = {}, now = new Date()): Promise<RefreshResult> {
  if (!refreshToken) return { ok: false, reason: "INVALID" };
  const hash = hashToken(refreshToken);
  const include = {
    user: {
      include: { memberships: { orderBy: { createdAt: "asc" as const }, take: 1, include: { organization: { select: { status: true } } } } },
    },
  };

  let row = await prisma.deviceToken.findUnique({ where: { refreshHash: hash }, include });
  if (!row) {
    const old = await prisma.deviceToken.findUnique({ where: { prevRefreshHash: hash }, include });
    if (!old || old.revokedAt) return { ok: false, reason: "INVALID" };
    const retry = old.rotatedAt !== null && now.getTime() - old.rotatedAt.getTime() <= REFRESH_GRACE_MS;
    if (!retry) {
      await prisma.deviceToken.update({ where: { id: old.id }, data: { revokedAt: now } });
      return { ok: false, reason: "REUSED", userId: old.userId, deviceName: old.deviceName, deviceTokenId: old.id };
    }
    row = old; // reintento legítimo: se rota otra vez a partir del vigente
  }

  const membership = row.user.memberships[0];
  const valid =
    !row.revokedAt &&
    row.refreshExpiresAt !== null &&
    row.refreshExpiresAt > now &&
    row.user.active &&
    membership !== undefined &&
    membership.organization.status === "ACTIVE" &&
    DOOR_APP_ROLES.includes(membership.role);
  if (!valid) return { ok: false, reason: "INVALID", userId: row.userId, deviceName: row.deviceName, deviceTokenId: row.id };

  const token = randomBytes(32).toString("base64url");
  const next = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_MINUTES * 60_000);
  // Condicional sobre el hash vigente: si dos renovaciones llegan a la vez, solo una gana.
  const { count } = await prisma.deviceToken.updateMany({
    where: { id: row.id, refreshHash: row.refreshHash },
    data: {
      tokenHash: hashToken(token),
      refreshHash: hashToken(next),
      prevRefreshHash: hash,
      rotatedAt: now,
      expiresAt,
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_DAYS * 24 * 60 * 60_000),
      lastSeenAt: now,
      ip: context.ip ?? row.ip,
      appVersion: context.appVersion ?? row.appVersion,
      platform: context.platform ?? row.platform,
    },
  });
  if (count === 0) return { ok: false, reason: "BUSY", userId: row.userId, deviceName: row.deviceName, deviceTokenId: row.id };
  return { ok: true, token, refreshToken: next, expiresAt, userId: row.userId, deviceName: row.deviceName, deviceTokenId: row.id };
}

export async function endDeviceSession(token: string) {
  await prisma.deviceToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoca un teléfono (solo de la organización indicada): pierde el acceso en su próxima llamada. */
export async function revokeDevice(deviceTokenId: string, organizationId: string) {
  await prisma.deviceToken.updateMany({
    where: {
      id: deviceTokenId,
      revokedAt: null,
      user: { memberships: { some: { organizationId } } },
    },
    data: { revokedAt: new Date() },
  });
}

/** Métodos de lectura que admiten las entradas de una función (y de una puerta, si tiene secciones). */
async function sessionMethods(sessionId: string, gateSectionIds?: string[]): Promise<AccessMethod[]> {
  const types = await prisma.ticketType.findMany({
    where: {
      sessionId,
      ...(gateSectionIds?.length ? { OR: [{ sectionId: { in: gateSectionIds } }, { sectionId: null }] } : {}),
    },
    select: { accessMethods: true },
  });
  const found = new Set(types.flatMap((t) => t.accessMethods));
  return ALL_ACCESS_METHODS.filter((m) => found.has(m));
}

/**
 * Funciones que este usuario puede controlar con la app.
 * - Portero (OPERATOR): solo las que le asignaron en el panel.
 * - Dueño/administrador: todas las próximas de la organización (para pruebas y supervisión).
 */
export async function getDoorAssignments(staff: DoorStaff) {
  const where = {
    cancelledAt: null,
    startsAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    event: { organizationId: staff.organizationId, status: { not: "CANCELLED" as const } },
  };
  const include = {
    event: { select: { title: true, mode: true } },
    venue: {
      select: {
        name: true,
        timezone: true,
        accessPoints: { orderBy: { name: "asc" as const }, select: { id: true, name: true, sections: { select: { id: true } } } },
      },
    },
  };

  const rows =
    staff.role === "OPERATOR"
      ? (
          await prisma.doorAssignment.findMany({
            where: { userId: staff.id, session: where },
            include: { session: { include } },
            orderBy: { session: { startsAt: "asc" } },
          })
        ).map((a) => ({ session: a.session, assignedGateId: a.accessPointId }))
      : (await prisma.eventSession.findMany({ where, include, orderBy: { startsAt: "asc" }, take: 50 })).map((session) => ({
          session,
          assignedGateId: null as string | null,
        }));

  return Promise.all(
    rows.map(async ({ session, assignedGateId }) => {
      const assigned = assignedGateId ? session.venue.accessPoints.find((g) => g.id === assignedGateId) : undefined;
      return {
        sessionId: session.id,
        title: session.event.title,
        startsAt: session.startsAt.toISOString(),
        venue: session.venue.name,
        timezone: session.venue.timezone,
        /** Si el portero tiene una puerta asignada, solo esa; si no, puede elegir cualquiera. */
        gates: (assigned ? [assigned] : session.venue.accessPoints).map((g) => ({ id: g.id, name: g.name })),
        methods: await sessionMethods(session.id, assigned?.sections.map((s) => s.id)),
      };
    }),
  );
}

/** ¿Puede este usuario controlar esta función con la app? */
export async function canControlSession(staff: DoorStaff, sessionId: string) {
  const session = await prisma.eventSession.findFirst({
    where: { id: sessionId, cancelledAt: null, event: { organizationId: staff.organizationId, status: { not: "CANCELLED" } } },
    select: { id: true, venueId: true },
  });
  if (!session) return null;
  if (staff.role !== "OPERATOR") return { ...session, assignedGateId: null as string | null };
  const assignment = await prisma.doorAssignment.findUnique({
    where: { userId_sessionId: { userId: staff.id, sessionId } },
    select: { accessPointId: true },
  });
  return assignment ? { ...session, assignedGateId: assignment.accessPointId } : null;
}

const STATUS_CODE = { VALID: "V", USED: "U", CANCELLED: "C" } as const;

/**
 * Datos que descarga la app para validar sin internet.
 *
 * - Las entradas de la puerta elegida van completas (titular, tipo, butaca, métodos).
 * - Las de otras puertas van compactas (solo código, sección y estado): sirven para decir
 *   "puerta equivocada, esta entrada entra por X" en vez de "no existe".
 * - Con `since`, devuelve solo lo que cambió desde esa hora (ventas nuevas, usadas, anuladas).
 * - No incluye el secreto del QR: el teléfono valida que el código exista en la lista.
 */
export async function getDoorDownload(input: { sessionId: string; accessPointId?: string; since?: Date }) {
  const session = await prisma.eventSession.findUnique({
    where: { id: input.sessionId },
    include: {
      event: { select: { title: true } },
      venue: {
        select: {
          name: true,
          timezone: true,
          accessPoints: { orderBy: { name: "asc" }, include: { sections: { select: { id: true, name: true } } } },
          sections: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!session) return null;

  const gate = input.accessPointId ? session.venue.accessPoints.find((g) => g.id === input.accessPointId) : undefined;
  const gateSections = new Set(gate?.sections.map((s) => s.id) ?? []);
  const restricted = gateSections.size > 0;
  const since = input.since;
  const syncedAt = new Date();

  const tickets = await prisma.ticket.findMany({
    where: {
      sessionId: input.sessionId,
      ...(since
        ? {
            OR: [
              { issuedAt: { gte: since } },
              { usedAt: { gte: since } },
              { cancelledAt: { gte: since } },
              // Transferida: lleva código y titular nuevos.
              { transferredAt: { gte: since } },
            ],
          }
        : {}),
    },
    select: {
      code: true,
      status: true,
      holderName: true,
      holderDocument: true,
      ticketType: { select: { name: true, sectionId: true, accessMethods: true } },
      seat: { select: { label: true } },
      order: { select: { buyerName: true, buyerDocument: true } },
    },
  });

  // Códigos que dejaron de valer por una transferencia: el teléfono los saca de su lista.
  const revoked = since
    ? (
        await prisma.ticketTransfer.findMany({
          where: { status: "ACCEPTED", resolvedAt: { gte: since }, oldCode: { not: null }, ticket: { sessionId: input.sessionId } },
          select: { oldCode: true },
        })
      ).flatMap((t) => (t.oldCode ? [t.oldCode] : []))
    : [];

  return {
    syncedAt: syncedAt.toISOString(),
    full: !since,
    revoked,
    session: {
      id: session.id,
      title: session.event.title,
      startsAt: session.startsAt.toISOString(),
      venue: session.venue.name,
      timezone: session.venue.timezone,
    },
    gateId: gate?.id ?? null,
    gates: session.venue.accessPoints.map((g) => ({ id: g.id, name: g.name, sectionIds: g.sections.map((s) => s.id) })),
    sections: Object.fromEntries(session.venue.sections.map((s) => [s.id, s.name])),
    tickets: tickets.map((t) => {
      const sectionId = t.ticketType.sectionId;
      const mine = !restricted || (sectionId !== null && gateSections.has(sectionId));
      const base = { code: t.code, status: STATUS_CODE[t.status], sectionId, mine };
      return mine
        ? {
            ...base,
            holder: t.holderName ?? t.order.buyerName,
            // Titular actual: si la entrada se transfirió, el carnet es el de quien la recibió.
            document: t.holderDocument ?? t.order.buyerDocument,
            type: t.ticketType.name,
            seat: t.seat?.label ?? null,
            methods: t.ticketType.accessMethods,
          }
        : base;
    }),
  };
}

export type DoorDownload = NonNullable<Awaited<ReturnType<typeof getDoorDownload>>>;
