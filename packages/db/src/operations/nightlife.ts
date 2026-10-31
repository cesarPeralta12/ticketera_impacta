/**
 * Boliches: consumo en barra (el saldo de una mesa o de una entrada con trago), entradas que solo valen
 * hasta una hora y noches que se repiten cada semana.
 */
import { parseVoucherPayload, peopleIn, tableLabel, utcToZonedInput, weeklyNights, zonedDateTimeToUtc } from "@ticketera/core";
import { prisma } from "../client";
import { assertCanSell } from "./sales-scope";
import type { Prisma } from "../generated/prisma/client";
import { DomainError, TX_OPTIONS, audit, requireEnv } from "./shared";

/** Código del vale a partir de lo que llega a la barra: el QR de consumo (con su firma) o el código escrito. */
async function voucherCodeFrom(raw: string): Promise<string | null> {
  const value = raw.trim();
  if (!value) return null;
  const parsed = await parseVoucherPayload(value, requireEnv("TICKET_QR_SECRET"));
  return parsed.ok ? parsed.code : null;
}

const voucherInclude = {
  ticketType: { select: { name: true, kind: true, peoplePerUnit: true } },
  seat: { select: { label: true } },
  order: { select: { code: true, buyerName: true } },
  tickets: { select: { status: true } },
  redemptions: { orderBy: { createdAt: "desc" }, take: 1, include: { staff: { select: { name: true } } } },
} as const;

type VoucherRow = NonNullable<Awaited<ReturnType<typeof findVoucher>>>;

function findVoucher(code: string) {
  return prisma.consumptionCredit.findUnique({ where: { code }, include: voucherInclude });
}

/** Un vale de consumo para mostrarlo en la barra (panel y app). */
export type Voucher = {
  code: string;
  label: string;
  kind: string;
  people: number;
  buyer: string;
  orderCode: string;
  amount: number;
  currency: string;
  /** La compra se anuló: el vale no vale. */
  cancelled: boolean;
  redeemedAt: Date | null;
  redeemedBy: string | null;
  note: string | null;
};

function toVoucher(row: VoucherRow): Voucher {
  const last = row.redemptions[0];
  return {
    code: row.code,
    label: tableLabel(row.ticketType.name, row.tableNumber, row.seat?.label) ?? row.ticketType.name,
    kind: row.ticketType.kind,
    people: peopleIn(row.ticketType),
    buyer: row.order.buyerName,
    orderCode: row.order.code,
    amount: row.amount,
    currency: row.currency,
    cancelled: row.tickets.length > 0 && row.tickets.every((t) => t.status === "CANCELLED"),
    redeemedAt: row.redeemedAt,
    redeemedBy: last?.staff.name ?? null,
    note: last?.note ?? null,
  };
}

export type VoucherLookup = { ok: true; voucher: Voucher } | { ok: false; reason: string; code: "NOT_FOUND" | "WRONG_NIGHT" | "NO_CONSUMPTION" };

/**
 * Datos del vale de consumo de una noche. Un vale ya leído sí se devuelve (con quién y cuándo): la barra muestra
 * "ya fue leído". Solo de la noche elegida; una compra sin consumo incluido devuelve el motivo.
 */
export async function getVoucher(raw: string, sessionId: string): Promise<VoucherLookup> {
  const code = await voucherCodeFrom(raw);
  const row = code ? await findVoucher(code) : null;
  if (!row) return { ok: false, code: "NOT_FOUND", reason: "No encontramos ese QR de consumo. Revisa el código." };
  if (row.sessionId !== sessionId) return { ok: false, code: "WRONG_NIGHT", reason: "Ese QR de consumo es de otra noche." };
  if (row.amount <= 0) return { ok: false, code: "NO_CONSUMPTION", reason: "Esa mesa no tiene consumo incluido." };
  return { ok: true, voucher: toVoucher(row) };
}

export type VoucherRedeem =
  | { status: "REDEEMED"; voucher: Voucher }
  /** Ya se había leído: no se marca de nuevo. */
  | { status: "ALREADY_REDEEMED"; voucher: Voucher }
  | { status: "CANCELLED"; voucher: Voucher }
  | { status: "REJECTED"; code: "NOT_FOUND" | "WRONG_NIGHT" | "NO_CONSUMPTION"; reason: string };

/** La hora de lectura del teléfono no puede estar en el futuro ni más de 3 días atrás (reloj mal puesto). */
function clampReadAt(readAt: Date | undefined, now: Date) {
  if (!readAt || Number.isNaN(readAt.getTime())) return now;
  return new Date(Math.min(Math.max(readAt.getTime(), now.getTime() - 3 * 86_400_000), now.getTime()));
}

/**
 * Marca el vale como leído (un solo uso). Es un único UPDATE condicional (`redeemedAt IS NULL`): dos barras que lo
 * leen a la vez, o un teléfono sin conexión que sincroniza después, no pueden usarlo dos veces; gana la primera
 * escritura y la otra recibe ALREADY_REDEEMED con quién y cuándo. El consumo completo del vale queda como gastado.
 */
export async function redeemVoucher(input: { raw: string; sessionId: string; staffId: string; note?: string; readAt?: Date; now?: Date }): Promise<VoucherRedeem> {
  const now = input.now ?? new Date();
  // Una cuenta con funciones asignadas solo cobra en la barra de esas noches.
  const session = await prisma.eventSession.findUnique({ where: { id: input.sessionId }, select: { id: true, eventId: true, event: { select: { organizationId: true } } } });
  if (!session) throw new DomainError("NOT_FOUND", "Noche no encontrada.");
  await assertCanSell(prisma, { userId: input.staffId, organizationId: session.event.organizationId, session, now });

  const found = await getVoucher(input.raw, input.sessionId);
  if (!found.ok) return { status: "REJECTED", code: found.code, reason: found.reason };
  if (found.voucher.cancelled) return { status: "CANCELLED", voucher: found.voucher };
  if (found.voucher.redeemedAt) return { status: "ALREADY_REDEEMED", voucher: found.voucher };

  const readAt = clampReadAt(input.readAt, now);
  const note = input.note?.trim().slice(0, 120) || null;
  const code = found.voucher.code;
  const won = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; amount: number }[]>`
      UPDATE "ConsumptionCredit" SET "spent" = "amount", "redeemedAt" = ${readAt}
      WHERE "code" = ${code} AND "redeemedAt" IS NULL AND "amount" > 0
      RETURNING "id", "amount"`;
    const row = rows[0];
    if (!row) return false;
    const redemption = await tx.consumptionRedemption.create({ data: { creditId: row.id, amount: row.amount, staffId: input.staffId, note } });
    await audit(tx, {
      actorType: "staff",
      actorId: input.staffId,
      action: "consumption.voucher_read",
      entity: "ConsumptionCredit",
      entityId: row.id,
      data: { amount: row.amount, redemptionId: redemption.id, readAt: readAt.toISOString() },
    });
    return true;
  });
  const row = await findVoucher(code);
  const voucher = toVoucher(row!);
  return won ? { status: "REDEEMED", voucher } : { status: "ALREADY_REDEEMED", voucher };
}

/** Los vales de una noche para descargarlos al teléfono de la barra (solo mesas y entradas con consumo incluido). */
export async function nightVouchers(sessionId: string): Promise<Voucher[]> {
  const rows = await prisma.consumptionCredit.findMany({
    where: { sessionId, amount: { gt: 0 } },
    orderBy: [{ ticketType: { name: "asc" } }, { tableNumber: "asc" }, { createdAt: "asc" }],
    include: voucherInclude,
  });
  return rows.map(toVoucher);
}

/**
 * Los vales de una noche como tabla para la barra: se busca por código, comprador, orden, mesa, tipo, quién lo leyó o su
 * detalle, y se filtra por estado (leídos o sin leer) y por tipo. Paginado en la base de datos.
 */
export async function searchNightVouchers(input: { sessionId: string; q?: string; estado?: string; ticketTypeId?: string }, skip: number, take: number) {
  const q = input.q?.trim();
  const code = q?.replace(/[\s-]/g, "").toUpperCase();
  const where: Prisma.ConsumptionCreditWhereInput = {
    sessionId: input.sessionId,
    amount: { gt: 0 },
    ...(input.estado === "leidos" ? { redeemedAt: { not: null } } : input.estado === "sin-leer" ? { redeemedAt: null } : {}),
    ...(input.ticketTypeId ? { ticketTypeId: input.ticketTypeId } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: code ?? q } },
            { order: { code: { contains: code ?? q } } },
            { order: { buyerName: { contains: q, mode: "insensitive" } } },
            { order: { buyerEmail: { contains: q, mode: "insensitive" } } },
            { ticketType: { name: { contains: q, mode: "insensitive" } } },
            { redemptions: { some: { OR: [{ note: { contains: q, mode: "insensitive" } }, { staff: { name: { contains: q, mode: "insensitive" } } }] } } },
            ...(/^\d{1,4}$/.test(q) ? [{ tableNumber: Number(q) }] : []),
          ],
        }
      : {}),
  };
  const [total, sums, rows] = await Promise.all([
    prisma.consumptionCredit.count({ where }),
    prisma.consumptionCredit.aggregate({ where, _sum: { amount: true } }),
    prisma.consumptionCredit.findMany({ where, orderBy: [{ ticketType: { name: "asc" } }, { tableNumber: "asc" }, { createdAt: "asc" }], skip, take, include: voucherInclude }),
  ]);
  return { total, amount: sums._sum.amount ?? 0, rows: rows.map(toVoucher) };
}

/** Totales de consumo de una noche para la Barra: incluido, consumido y lo último cobrado. */
export async function nightConsumption(sessionId: string) {
  const [totals, byType, recent] = await Promise.all([
    prisma.consumptionCredit.aggregate({ where: { sessionId }, _sum: { amount: true, spent: true }, _count: true }),
    prisma.consumptionCredit.groupBy({ by: ["ticketTypeId"], where: { sessionId }, _count: true, _sum: { amount: true, spent: true } }),
    prisma.consumptionRedemption.findMany({
      where: { credit: { sessionId } },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { staff: { select: { name: true } }, credit: { include: { ticketType: { select: { name: true } }, seat: { select: { label: true } } } } },
    }),
  ]);
  const names = new Map(
    (await prisma.ticketType.findMany({ where: { id: { in: byType.map((t) => t.ticketTypeId) } }, select: { id: true, name: true, kind: true } })).map(
      (t) => [t.id, t],
    ),
  );
  return {
    credits: totals._count,
    amount: totals._sum.amount ?? 0,
    spent: totals._sum.spent ?? 0,
    byType: byType.map((t) => ({
      name: names.get(t.ticketTypeId)?.name ?? "?",
      kind: names.get(t.ticketTypeId)?.kind ?? "ENTRY",
      count: t._count,
      amount: t._sum.amount ?? 0,
      spent: t._sum.spent ?? 0,
    })),
    recent,
  };
}

/**
 * Las entradas con horario de ingreso que no se usaron a tiempo quedan anuladas: las de su propio horario ("free
 * hasta la 01:00") y, pasado el último ingreso de la función, todas las demás. Así la app de puerta, que valida
 * contra su lista descargada, las ve anuladas al sincronizar.
 */
export async function expireTimedTickets(sessionId: string, now = new Date()) {
  const session = await prisma.eventSession.findUnique({ where: { id: sessionId }, select: { lastEntryAt: true } });
  const sessionClosed = Boolean(session?.lastEntryAt && session.lastEntryAt <= now);
  const { count } = await prisma.ticket.updateMany({
    where: {
      sessionId,
      status: "VALID",
      ticketType: sessionClosed ? { OR: [{ entryUntil: { lte: now } }, { entryUntil: null }] } : { entryUntil: { lte: now } },
    },
    data: { status: "CANCELLED", cancelledAt: now, expiredAt: now },
  });
  return count;
}

type Template = NonNullable<Awaited<ReturnType<typeof loadTemplate>>>;
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function loadTemplate(sessionId: string) {
  return prisma.eventSession.findUnique({
    where: { id: sessionId },
    include: {
      ticketTypes: { orderBy: { sortOrder: "asc" }, include: { zones: { select: { id: true } } } },
      doorAssignments: true,
      venue: { select: { timezone: true } },
    },
  });
}

/**
 * Crea una copia de la función modelo que empieza en `startsAt`: sus horarios (puertas, llegada, fin, venta),
 * sus tipos de entrada con precios, cupos, mesas, consumo y horario de ingreso, y sus porteros. Todas las
 * fechas se corren lo mismo que el inicio; cada copia tiene su propio cupo.
 */
async function copySession(tx: Tx, template: Template, startsAt: Date) {
  const delta = startsAt.getTime() - template.startsAt.getTime();
  const shift = (date: Date | null) => (date ? new Date(date.getTime() + delta) : null);
  const night = await tx.eventSession.create({
    data: {
      eventId: template.eventId,
      venueId: template.venueId,
      startsAt,
      endsAt: shift(template.endsAt),
      doorsOpenAt: shift(template.doorsOpenAt),
      arrivalAt: shift(template.arrivalAt),
      lastEntryAt: shift(template.lastEntryAt),
      program: template.program ?? undefined,
      salesStartAt: shift(template.salesStartAt),
      salesEndAt: shift(template.salesEndAt),
      queueEnabled: template.queueEnabled,
      maxConcurrentCheckouts: template.maxConcurrentCheckouts,
    },
  });
  const types = template.ticketTypes.map((t) => ({
    data: {
      sessionId: night.id,
      sectionId: t.sectionId,
      name: t.name,
      description: t.description,
      unitAmount: t.unitAmount,
      currency: t.currency,
      capacity: t.capacity,
      maxPerOrder: t.maxPerOrder,
      salesStartAt: shift(t.salesStartAt),
      salesEndAt: shift(t.salesEndAt),
      presale: t.presale,
      discountPercent: t.discountPercent,
      discountStartsAt: shift(t.discountStartsAt),
      discountEndsAt: shift(t.discountEndsAt),
      sortOrder: t.sortOrder,
      accessMethods: t.accessMethods,
      qrMode: t.qrMode,
      kind: t.kind,
      peoplePerUnit: t.peoplePerUnit,
      consumptionAmount: t.consumptionAmount,
      entryUntil: shift(t.entryUntil),
      maxEntries: t.maxEntries,
      // Fases de venta: la copia sigue siendo una cadena de fases (si no, todas se venderían a la vez).
      phaseOrder: t.phaseOrder,
      phaseStartsAt: shift(t.phaseStartsAt),
    },
    zones: t.zones,
  }));
  await tx.ticketType.createMany({ data: types.map((t) => t.data) });
  // Las zonas que abre cada tipo (relación de muchos a muchos: createMany no la carga).
  for (const t of types.filter((x) => x.zones.length > 0)) {
    await tx.ticketType.update({
      where: { id: (await tx.ticketType.findFirstOrThrow({ where: { sessionId: night.id, name: t.data.name, sortOrder: t.data.sortOrder } })).id },
      data: { zones: { connect: t.zones } },
    });
  }
  if (template.doorAssignments.length > 0) {
    await tx.doorAssignment.createMany({
      data: template.doorAssignments.map((a) => ({ userId: a.userId, sessionId: night.id, accessPointId: a.accessPointId })),
    });
  }
  return night;
}

/**
 * "Repetir noches": copia una noche (sus tipos de entrada, precios, mesas, horarios de venta e ingreso y sus
 * porteros) a los días elegidos de las próximas semanas. Las fechas se corren lo mismo que la noche; no
 * crea una noche que ya existe a esa hora.
 */
export async function repeatWeeklyNights(input: { templateSessionId: string; weekdays: number[]; weeks: number; staffId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const template = await loadTemplate(input.templateSessionId);
  if (!template) throw new DomainError("NOT_FOUND", "Noche no encontrada.");
  if (template.ticketTypes.length === 0) {
    throw new DomainError("INVALID_STATE", "Primero carga los precios de esta noche: se copian a las demás.");
  }

  const dates = weeklyNights({ template: template.startsAt, weekdays: input.weekdays, weeks: input.weeks, timeZone: template.venue.timezone });
  const existing = await prisma.eventSession.findMany({ where: { eventId: template.eventId, cancelledAt: null }, select: { startsAt: true } });
  const taken = new Set(existing.map((s) => s.startsAt.getTime()));
  const fresh = dates.filter((d) => d > now && !taken.has(d.getTime()));

  await prisma.$transaction(async (tx) => {
    for (const startsAt of fresh) await copySession(tx, template, startsAt);
    await audit(tx, {
      actorType: "staff",
      actorId: input.staffId,
      action: "session.repeat_weekly",
      entity: "EventSession",
      entityId: template.id,
      data: { weekdays: input.weekdays, weeks: input.weeks, created: fresh.length },
    });
  }, { ...TX_OPTIONS, timeout: 60_000 });

  return { created: fresh.length, skipped: dates.length - fresh.length };
}

/**
 * "Nueva noche" o "Duplicar función": copia una función a otro día, a la misma hora del reloj del recinto,
 * con todo lo suyo (ver copySession). Para boliches es el caso de todas las semanas: tres clics.
 */
export async function duplicateSession(input: { templateSessionId: string; date: string; staffId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const template = await loadTemplate(input.templateSessionId);
  if (!template) throw new DomainError("NOT_FOUND", "Función no encontrada.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new DomainError("INVALID_ITEMS", "Elige el día.");
  const clock = utcToZonedInput(template.startsAt, template.venue.timezone).slice(11, 16);
  // Se conservan los segundos de la modelo para que todas las fechas se corran exacto.
  const startsAt = new Date(zonedDateTimeToUtc(`${input.date}T${clock}`, template.venue.timezone).getTime() + (template.startsAt.getTime() % 60_000));
  if (startsAt <= now) throw new DomainError("INVALID_ITEMS", "Ese día ya pasó: elige uno que venga.");
  const clash = await prisma.eventSession.findFirst({ where: { eventId: template.eventId, cancelledAt: null, startsAt } });
  if (clash) throw new DomainError("INVALID_STATE", "Ya hay una función ese día a esa hora.");

  return prisma.$transaction(async (tx) => {
    const night = await copySession(tx, template, startsAt);
    await audit(tx, {
      actorType: "staff",
      actorId: input.staffId,
      action: "session.duplicate",
      entity: "EventSession",
      entityId: night.id,
      data: { from: template.id },
    });
    return night;
  }, TX_OPTIONS);
}
