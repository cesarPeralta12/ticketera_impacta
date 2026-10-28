/**
 * Promotores (RRPP): venden con cobro por QR los eventos que tienen asignados y ganan una comisión por cada venta
 * pagada, la que hacen desde su panel y la que se compra en la web con su código. La comisión de cada orden se
 * calcula al crearla (createPendingOrder) y cuenta recién cuando el pago queda aprobado.
 */
import {
  DEFAULT_TIMEZONE,
  MAX_FIXED_COMMISSION,
  isValidPromoCode,
  normalizePromoCode,
  promoterCode,
  utcToZonedInput,
  zonedDateTimeToUtc,
  type CheckoutInput,
  type CommissionRule,
} from "@ticketera/core";
import { prisma } from "../client";
import { hashPassword } from "./accounts";
import { createPendingOrder } from "./orders";
import { applyPaymentUpdate, startPayment } from "./payments";
import { setSalesAssignment } from "./sales-scope";
import { DomainError, audit, isUniqueViolation, type Db } from "./shared";

/**
 * Cobro de prueba mientras no hay un banco conectado: el QR que se muestra no cobra nada y el pago queda pendiente
 * hasta que se simula. Con una pasarela real, su proveedor reemplaza a este.
 */
export const SIMULATED_PROVIDER = "simulado";

/** Lo que cuenta como vendido: pagado (y lo que quedó de un reembolso parcial). */
const PAID = { in: ["PAID", "PARTIALLY_REFUNDED"] as ("PAID" | "PARTIALLY_REFUNDED")[] };

export function checkCommissionRule(rule: CommissionRule): string | null {
  if (!Number.isInteger(rule.commissionValue) || rule.commissionValue < 0) return "La comisión tiene que ser un número positivo.";
  if (rule.commissionType === "PERCENT" && rule.commissionValue > 100) return "El porcentaje va de 0 a 100.";
  if (rule.commissionType === "FIXED" && rule.commissionValue > MAX_FIXED_COMMISSION) return "El monto por entrada es demasiado alto.";
  return null;
}

/** La cuenta de promotor de la organización (activa), o null. */
export async function findPromoter(db: Db, organizationId: string, userId: string) {
  return db.staffUser.findFirst({
    where: { id: userId, active: true, memberships: { some: { organizationId, role: "PROMOTER" } } },
    select: { id: true, name: true, email: true, phone: true },
  });
}

/**
 * El código personal del promotor para la web (sin descuento: sirve para que lo que se compra con él sume a su
 * comisión). Uno por promotor y organización; se crea la primera vez que se le asigna un evento.
 */
export async function ensurePromoterCode(db: Db, organizationId: string, promoter: { id: string; name: string }) {
  const existing = await db.promoCode.findFirst({ where: { organizationId, promoterId: promoter.id, eventId: null, discountValue: 0 } });
  if (existing) return existing;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.promoCode.create({
        data: {
          organizationId,
          code: promoterCode(promoter.name),
          description: `Código del promotor ${promoter.name}`,
          discountType: "PERCENT",
          discountValue: 0,
          promoterId: promoter.id,
          promoterName: promoter.name,
        },
      });
    } catch (error) {
      if (attempt < 4 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}

export type PromoterAssignmentInput = {
  organizationId: string;
  userId: string;
  eventId: string;
  rule: CommissionRule;
  /** Cupo de entradas que puede vender él en el evento; vacío: hasta agotar. */
  quota?: number | null;
  /** Funciones que vende; vacío: todas las del evento. */
  sessionIds?: string[];
  /** Vigencia opcional de la asignación. */
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export function checkQuota(quota: number | null | undefined): string | null {
  if (quota === null || quota === undefined) return null;
  return Number.isInteger(quota) && quota >= 1 && quota <= 1_000_000 ? null : "El cupo es un número de entradas (ej. 100), o vacío para vender hasta agotar.";
}

/**
 * Asigna (o actualiza) un evento a un promotor: su comisión, su cupo, qué funciones vende y desde/hasta cuándo.
 * Lo que marques es lo que vende: las funciones de ese evento que tenía antes se reemplazan.
 */
export async function assignPromoter(input: PromoterAssignmentInput, db?: Db) {
  const problem = checkCommissionRule(input.rule) ?? checkQuota(input.quota);
  if (problem) throw new DomainError("INVALID_ITEMS", problem);
  const run = async (tx: Db) => {
    const promoter = await findPromoter(tx, input.organizationId, input.userId);
    const event = await tx.event.findFirst({ where: { id: input.eventId, organizationId: input.organizationId }, select: { id: true, mode: true } });
    if (!promoter || !event) throw new DomainError("NOT_FOUND", "Promotor o evento no encontrado.");
    if (event.mode !== "TICKETING") throw new DomainError("INVALID_ITEMS", "Ese evento es solo con lista de invitados: no tiene venta.");
    const data = { ...input.rule, quota: input.quota ?? null };
    const assignment = await tx.promoterAssignment.upsert({
      where: { userId_eventId: { userId: promoter.id, eventId: event.id } },
      create: { userId: promoter.id, eventId: event.id, ...data },
      update: data,
    });
    const scope = await setSalesAssignment(tx, {
      organizationId: input.organizationId,
      userId: promoter.id,
      eventId: event.id,
      sessionIds: input.sessionIds,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    const code = await ensurePromoterCode(tx, input.organizationId, promoter);
    return { assignment, code, scope };
  };
  return db ? run(db) : prisma.$transaction(run);
}

/** Quita un evento al promotor (comisión y funciones). Lo que ya vendió sigue sumando a su comisión. */
export async function unassignPromoter(organizationId: string, userId: string, eventId: string) {
  const [{ count }] = await prisma.$transaction([
    prisma.promoterAssignment.deleteMany({ where: { userId, eventId, event: { organizationId } } }),
    prisma.salesAssignment.deleteMany({ where: { userId, eventId, event: { organizationId } } }),
  ]);
  return count > 0;
}

/**
 * Alta de un promotor en un solo paso: la cuenta (con contraseña temporal, que cambia al entrar), su teléfono, su
 * primer evento con las funciones, la comisión y el cupo, y su código (el que se elija, o uno con su nombre). Todo se
 * valida antes de crear la cuenta y se guarda junto: si algo está mal, no queda nada a medias.
 */
export async function createPromoterAccount(input: {
  organizationId: string;
  name: string;
  email: string;
  phone?: string | null;
  password: string;
  code?: string | null;
  assignment: Omit<PromoterAssignmentInput, "organizationId" | "userId">;
}) {
  const problem = checkCommissionRule(input.assignment.rule) ?? checkQuota(input.assignment.quota);
  if (problem) throw new DomainError("INVALID_ITEMS", problem);
  const email = input.email.trim().toLowerCase();
  if (await prisma.staffUser.findUnique({ where: { email } })) throw new DomainError("DUPLICATE", "Ya existe una cuenta con ese email.");
  const code = input.code ? normalizePromoCode(input.code) : null;
  if (code) {
    if (!isValidPromoCode(code)) throw new DomainError("INVALID_ITEMS", "El código: de 3 a 24 letras, números o guiones (ej. RP-JUAN).");
    if (await prisma.promoCode.findFirst({ where: { organizationId: input.organizationId, code } })) {
      throw new DomainError("DUPLICATE", `El código ${code} ya existe: elige otro.`);
    }
  }
  const event = await prisma.event.findFirst({ where: { id: input.assignment.eventId, organizationId: input.organizationId }, select: { mode: true } });
  if (!event) throw new DomainError("NOT_FOUND", "Evento no encontrado.");
  if (event.mode !== "TICKETING") throw new DomainError("INVALID_ITEMS", "Ese evento es solo con lista de invitados: no tiene venta.");

  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.staffUser.create({
      data: {
        name: input.name.trim(),
        email,
        phone: input.phone?.trim() || null,
        passwordHash,
        mustChangePassword: true,
        memberships: { create: { organizationId: input.organizationId, role: "PROMOTER", salesScope: "ASSIGNED" } },
      },
    });
    // Con un código elegido, ese es su código personal (sin descuento); si no, se arma uno con su nombre.
    if (code) {
      await tx.promoCode.create({
        data: {
          organizationId: input.organizationId,
          code,
          description: `Código del promotor ${user.name}`,
          discountType: "PERCENT",
          discountValue: 0,
          promoterId: user.id,
          promoterName: user.name,
        },
      });
    }
    const assigned = await assignPromoter({ ...input.assignment, organizationId: input.organizationId, userId: user.id }, tx);
    return { user, ...assigned };
  });
}

/** Los eventos que vende el promotor, con sus funciones por delante y cuáles puede vender (las asignadas y vigentes). */
export async function promoterEvents(userId: string, organizationId: string, now = new Date()) {
  const [assignments, scope] = await Promise.all([
    prisma.promoterAssignment.findMany({
      where: { userId, event: { organizationId } },
      orderBy: { createdAt: "asc" },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            mode: true,
            category: true,
            sessions: {
              where: { cancelledAt: null, startsAt: { gt: new Date(now.getTime() - 12 * 3_600_000) } },
              orderBy: { startsAt: "asc" },
              select: { id: true, eventId: true, startsAt: true, endsAt: true, salesEndAt: true, lastEntryAt: true, venue: { select: { name: true, timezone: true } } },
            },
          },
        },
      },
    }),
    prisma.salesAssignment.findMany({ where: { userId, event: { organizationId } } }),
  ]);
  const live = (a: { active: boolean; startsAt: Date | null; endsAt: Date | null }) => a.active && (!a.startsAt || a.startsAt <= now) && (!a.endsAt || a.endsAt > now);
  return assignments.map((a) => {
    const rows = scope.filter((s) => s.eventId === a.eventId);
    return {
      ...a,
      /** Funciones elegidas (vacío: todas) y vigencia, para mostrarlas y editarlas. */
      scope: {
        whole: rows.some((r) => !r.sessionId),
        sessionIds: rows.flatMap((r) => (r.sessionId ? [r.sessionId] : [])),
        startsAt: rows[0]?.startsAt ?? null,
        endsAt: rows[0]?.endsAt ?? null,
      },
      event: {
        ...a.event,
        sessions: a.event.sessions.map((s) => ({ ...s, assigned: rows.some((r) => live(r) && (!r.sessionId || r.sessionId === s.id)) })),
      },
    };
  });
}

/**
 * Lo que lleva vendido un promotor: totales pagados (y su comisión), lo que espera pago, por evento y las últimas
 * ventas. `organizationId` limita a los eventos de esa organización (la que se está mirando).
 */
export async function promoterSales(userId: string, options: { organizationId?: string; take?: number } = {}, now = new Date()) {
  const scope = { promoterId: userId, ...(options.organizationId ? { items: { some: { ticketType: { session: { event: { organizationId: options.organizationId } } } } } } : {}) };
  // "Hoy" es el día en Bolivia (la medianoche de La Paz), no el del servidor.
  const today = zonedDateTimeToUtc(`${utcToZonedInput(now, DEFAULT_TIMEZONE).slice(0, 10)}T00:00`, DEFAULT_TIMEZONE);
  const [paid, tickets, waiting, orders, day, dayTickets, unsettled, payouts] = await Promise.all([
    prisma.order.aggregate({ where: { ...scope, status: PAID }, _sum: { totalAmount: true, commissionAmount: true }, _count: true }),
    prisma.ticket.count({ where: { order: { ...scope, status: PAID }, status: { in: ["VALID", "USED"] } } }),
    prisma.order.aggregate({ where: { ...scope, status: "PENDING_PAYMENT", expiresAt: { gt: now } }, _sum: { commissionAmount: true }, _count: true }),
    prisma.order.findMany({
      where: { ...scope, status: { in: ["PAID", "PARTIALLY_REFUNDED", "PENDING_PAYMENT", "EXPIRED", "CANCELLED", "REFUNDED"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        code: true,
        status: true,
        channel: true,
        buyerName: true,
        buyerPhone: true,
        totalAmount: true,
        commissionAmount: true,
        currency: true,
        createdAt: true,
        paidAt: true,
        expiresAt: true,
        _count: { select: { tickets: true } },
        commissionPayoutId: true,
        items: { take: 1, select: { ticketType: { select: { session: { select: { id: true, event: { select: { id: true, title: true } } } } } } } },
      },
    }),
    prisma.order.aggregate({ where: { ...scope, status: PAID, paidAt: { gte: today } }, _sum: { totalAmount: true, commissionAmount: true }, _count: true }),
    prisma.ticket.count({ where: { order: { ...scope, status: PAID, paidAt: { gte: today } }, status: { in: ["VALID", "USED"] } } }),
    prisma.order.aggregate({ where: { ...scope, status: PAID, commissionPayoutId: null }, _sum: { commissionAmount: true }, _count: true }),
    prisma.commissionPayout.findMany({
      where: { promoterId: userId, ...(options.organizationId ? { organizationId: options.organizationId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { createdBy: { select: { name: true } } },
    }),
  ]);
  const byEvent = new Map<string, { eventId: string; title: string; orders: number; tickets: number; amount: number; commission: number }>();
  for (const o of orders) {
    if (o.status !== "PAID" && o.status !== "PARTIALLY_REFUNDED") continue;
    const event = o.items[0]?.ticketType.session.event;
    if (!event) continue;
    const row = byEvent.get(event.id) ?? { eventId: event.id, title: event.title, orders: 0, tickets: 0, amount: 0, commission: 0 };
    byEvent.set(event.id, {
      ...row,
      orders: row.orders + 1,
      tickets: row.tickets + o._count.tickets,
      amount: row.amount + o.totalAmount,
      commission: row.commission + o.commissionAmount,
    });
  }
  return {
    totals: {
      orders: paid._count,
      tickets,
      amount: paid._sum.totalAmount ?? 0,
      commission: paid._sum.commissionAmount ?? 0,
      waitingOrders: waiting._count,
      waitingCommission: waiting._sum.commissionAmount ?? 0,
      /** Comisión de lo pagado que todavía no se le liquidó (y en cuántas ventas). */
      toSettle: unsettled._sum.commissionAmount ?? 0,
      toSettleOrders: unsettled._count,
    },
    /** Lo pagado hoy (día de Bolivia). */
    today: { orders: day._count, tickets: dayTickets, amount: day._sum.totalAmount ?? 0, commission: day._sum.commissionAmount ?? 0 },
    payouts,
    byEvent: [...byEvent.values()],
    recent: orders.slice(0, options.take ?? 20).map((o) => ({ ...o, event: o.items[0]?.ticketType.session.event ?? null, sessionId: o.items[0]?.ticketType.session.id ?? null })),
  };
}

/** Los promotores de una organización, con lo que vendió cada uno (pagado) y su comisión. */
export async function promotersReport(organizationId: string) {
  const promoters = await prisma.staffUser.findMany({
    where: { memberships: { some: { organizationId, role: "PROMOTER" } } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      active: true,
      promoterEvents: {
        where: { event: { organizationId } },
        select: { eventId: true, commissionType: true, commissionValue: true, quota: true, event: { select: { title: true } } },
      },
      promoterCodes: { where: { organizationId, eventId: null, discountValue: 0 }, select: { code: true }, take: 1 },
    },
  });
  const inOrg = { promoterId: { in: promoters.map((p) => p.id) }, status: PAID, items: { some: { ticketType: { session: { event: { organizationId } } } } } };
  const [sums, unsettled] = await Promise.all([
    prisma.order.groupBy({ by: ["promoterId"], where: inOrg, _sum: { totalAmount: true, commissionAmount: true }, _count: true }),
    prisma.order.groupBy({ by: ["promoterId"], where: { ...inOrg, commissionPayoutId: null }, _sum: { commissionAmount: true } }),
  ]);
  const byPromoter = new Map(sums.map((s) => [s.promoterId, s]));
  const toSettle = new Map(unsettled.map((s) => [s.promoterId, s._sum.commissionAmount ?? 0]));
  return promoters.map((p) => {
    const sum = byPromoter.get(p.id);
    return {
      ...p,
      code: p.promoterCodes[0]?.code ?? null,
      orders: sum?._count ?? 0,
      amount: sum?._sum.totalAmount ?? 0,
      commission: sum?._sum.commissionAmount ?? 0,
      /** Comisión ganada que todavía no se le pagó. */
      toSettle: toSettle.get(p.id) ?? 0,
    };
  });
}

/**
 * Liquida la comisión de un promotor: marca como pagadas todas sus ventas pagadas que todavía no se le liquidaron
 * (de esta organización) y guarda cuánto se le pagó. Lo que venda después queda para la próxima liquidación.
 */
export async function settlePromoterCommission(input: { organizationId: string; promoterId: string; staffId: string; note?: string }, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const promoter = await tx.staffUser.findFirst({ where: { id: input.promoterId, memberships: { some: { organizationId: input.organizationId, role: "PROMOTER" } } } });
    if (!promoter) throw new DomainError("NOT_FOUND", "Promotor no encontrado.");
    const orders = await tx.order.findMany({
      where: {
        promoterId: promoter.id,
        status: PAID,
        commissionPayoutId: null,
        commissionAmount: { gt: 0 },
        paidAt: { lte: now },
        items: { some: { ticketType: { session: { event: { organizationId: input.organizationId } } } } },
      },
      select: { id: true, commissionAmount: true, currency: true },
    });
    if (orders.length === 0) throw new DomainError("INVALID_STATE", "No tiene comisión pendiente de pago.");
    const payout = await tx.commissionPayout.create({
      data: {
        organizationId: input.organizationId,
        promoterId: promoter.id,
        amount: orders.reduce((sum, o) => sum + o.commissionAmount, 0),
        currency: orders[0]!.currency,
        orders: orders.length,
        note: input.note?.trim().slice(0, 200) || null,
        createdById: input.staffId,
      },
    });
    // Solo las que siguen sin liquidar: dos liquidaciones a la vez no pagan dos veces la misma venta.
    const { count } = await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) }, commissionPayoutId: null }, data: { commissionPayoutId: payout.id } });
    if (count !== orders.length) throw new DomainError("INVALID_STATE", "Otra liquidación se hizo al mismo tiempo: vuelve a intentar.");
    await audit(tx, {
      actorType: "staff",
      actorId: input.staffId,
      action: "promoter.commission_payout",
      entity: "CommissionPayout",
      entityId: payout.id,
      data: { promoterId: promoter.id, amount: payout.amount, orders: payout.orders },
      severity: "warn",
    });
    return payout;
  });
}

/**
 * Venta de un promotor: reserva las entradas a nombre del cliente y abre el cobro por QR. Las entradas se emiten
 * recién cuando el pago queda aprobado (el promotor nunca recibe efectivo).
 */
export async function sellAsPromoter(input: CheckoutInput, options: { promoterId: string; buyerPhone?: string; provider: string; now?: Date }) {
  const order = await createPendingOrder(input, {
    channel: "PROMOTER",
    issuedById: options.promoterId,
    promoterId: options.promoterId,
    buyerPhone: options.buyerPhone,
    now: options.now,
  });
  const payment = await startPayment(order.code, options.provider, options.now);
  return { order, payment };
}

/**
 * Aprueba el cobro de prueba de una venta de promotor (sin banco conectado), por las mismas reglas que un pago real:
 * reserva vigente, monto y moneda, cupo e idempotencia. Solo para el proveedor simulado.
 */
export async function approveSimulatedPayment(orderCode: string, now = new Date()) {
  const order = await prisma.order.findUnique({
    where: { code: orderCode },
    include: { payments: { where: { provider: SIMULATED_PROVIDER, status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order || order.channel !== "PROMOTER") throw new DomainError("NOT_FOUND", "Venta no encontrada.");
  if (order.status === "PAID") return "PAID" as const;
  const payment = order.payments[0] ?? (await startPayment(order.code, SIMULATED_PROVIDER, now));
  const { outcome } = await applyPaymentUpdate(
    {
      paymentId: payment.id,
      provider: SIMULATED_PROVIDER,
      providerPaymentId: `simulado_${payment.id}`,
      status: "APPROVED",
      providerStatus: "pago_simulado",
      amount: payment.amount,
      currency: payment.currency,
    },
    now,
  );
  return outcome;
}
