/**
 * Boliches: consumo en barra (el saldo de una mesa o de una entrada con trago), entradas que solo valen
 * hasta una hora y noches que se repiten cada semana.
 */
import { consumptionLeft, formatMoney, parseDynamicPayload, parseTicketPayload, utcToZonedInput, weeklyNights, zonedDateTimeToUtc } from "@ticketera/core";
import { prisma } from "../client";
import { DomainError, TX_OPTIONS, audit, requireEnv } from "./shared";

/** Lo más que se cobra de una vez en barra (Bs 100.000), para frenar un error de tipeo. */
export const MAX_REDEMPTION = 10_000_000;

/** Código de entrada a partir de lo que llega a la barra: el QR leído (fijo o dinámico) o el código escrito. */
async function ticketCodeFrom(raw: string): Promise<string | null> {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("TK2.")) return parseDynamicPayload(value)?.code ?? null;
  const parsed = await parseTicketPayload(value, requireEnv("TICKET_QR_SECRET"));
  return parsed.ok ? parsed.code : null;
}

const creditInclude = {
  ticketType: { select: { name: true, kind: true, peoplePerUnit: true } },
  seat: { select: { label: true } },
  order: { select: { code: true, buyerName: true } },
  tickets: { select: { code: true, status: true, holderName: true }, orderBy: { issuedAt: "asc" } },
  redemptions: { orderBy: { createdAt: "desc" }, take: 20, include: { staff: { select: { name: true } } } },
} as const;

/**
 * El saldo de consumo de una entrada (el de su mesa o el propio) para mostrarlo en la Barra. Solo de la
 * noche elegida: una entrada de otra noche o sin consumo incluido devuelve el motivo.
 */
export async function getConsumption(raw: string, sessionId: string) {
  const code = await ticketCodeFrom(raw);
  const ticket = code
    ? await prisma.ticket.findUnique({
        where: { code },
        select: { code: true, status: true, sessionId: true, holderName: true, credit: { include: creditInclude } },
      })
    : null;
  if (!ticket) return { ok: false as const, reason: "No encontramos esa entrada. Revisa el código." };
  if (ticket.sessionId !== sessionId) return { ok: false as const, reason: "Esa entrada es de otra noche." };
  if (!ticket.credit) return { ok: false as const, reason: "Esa entrada no tiene consumo incluido." };
  const credit = ticket.credit;
  return {
    ok: true as const,
    ticket: { code: ticket.code, status: ticket.status, holderName: ticket.holderName },
    credit: { ...credit, left: consumptionLeft(credit) },
  };
}

/**
 * Cobra un consumo contra el saldo. El descuento es un único UPDATE condicional (spent + monto ≤ amount):
 * dos barras cobrando a la misma mesa a la vez no pueden pasarse del saldo.
 */
export async function redeemConsumption(input: { raw: string; sessionId: string; amount: number; staffId: string; note?: string }) {
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > MAX_REDEMPTION) {
    throw new DomainError("INVALID_ITEMS", "Escribe un monto válido.");
  }
  const found = await getConsumption(input.raw, input.sessionId);
  if (!found.ok) throw new DomainError("NOT_FOUND", found.reason);
  if (found.credit.tickets.every((t) => t.status === "CANCELLED")) {
    throw new DomainError("INVALID_STATE", "Esa entrada está anulada: su consumo no se puede usar.");
  }
  const creditId = found.credit.id;

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ amount: number; spent: number; currency: string }[]>`
      UPDATE "ConsumptionCredit" SET "spent" = "spent" + ${input.amount}
      WHERE "id" = ${creditId} AND "spent" + ${input.amount} <= "amount"
      RETURNING "amount", "spent", "currency"`;
    const row = rows[0];
    if (!row) {
      const current = await tx.consumptionCredit.findUniqueOrThrow({ where: { id: creditId } });
      throw new DomainError(
        "INVALID_STATE",
        current.amount === 0
          ? "Esta mesa no tiene consumo incluido."
          : `No alcanza el saldo: quedan ${formatMoney(consumptionLeft(current), current.currency)}.`,
      );
    }
    const redemption = await tx.consumptionRedemption.create({
      data: { creditId, amount: input.amount, staffId: input.staffId, note: input.note?.trim().slice(0, 120) || null },
    });
    await audit(tx, {
      actorType: "staff",
      actorId: input.staffId,
      action: "consumption.redeem",
      entity: "ConsumptionCredit",
      entityId: creditId,
      data: { amount: input.amount, redemptionId: redemption.id },
    });
    return { amount: row.amount, spent: row.spent, left: consumptionLeft(row), currency: row.currency };
  });
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
 * Las entradas con horario de ingreso ("free hasta la 01:00") que no se usaron a tiempo quedan anuladas.
 * Así la app de puerta, que valida contra su lista descargada, las ve anuladas al sincronizar.
 */
export async function expireTimedTickets(sessionId: string, now = new Date()) {
  const { count } = await prisma.ticket.updateMany({
    where: { sessionId, status: "VALID", ticketType: { entryUntil: { lte: now } } },
    data: { status: "CANCELLED", cancelledAt: now, expiredAt: now },
  });
  return count;
}

type Template = NonNullable<Awaited<ReturnType<typeof loadTemplate>>>;
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function loadTemplate(sessionId: string) {
  return prisma.eventSession.findUnique({
    where: { id: sessionId },
    include: { ticketTypes: { orderBy: { sortOrder: "asc" } }, doorAssignments: true, venue: { select: { timezone: true } } },
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
      salesStartAt: shift(template.salesStartAt),
      salesEndAt: shift(template.salesEndAt),
      queueEnabled: template.queueEnabled,
      maxConcurrentCheckouts: template.maxConcurrentCheckouts,
    },
  });
  await tx.ticketType.createMany({
    data: template.ticketTypes.map((t) => ({
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
    })),
  });
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
