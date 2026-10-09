/**
 * Códigos promocionales: crear y administrar (panel) y aplicar a una compra (checkout y boletería).
 *
 * - Un código pertenece a una organización y puede limitarse a un evento.
 * - Los usos se cuentan por órdenes pagadas o con la reserva vigente: una orden que vence libera el uso.
 * - Al crear la orden, el código se vuelve a validar con su fila bloqueada: dos compras a la vez no pueden
 *   gastar el último uso dos veces.
 * - El descuento queda guardado en la orden (discountAmount) y en un registro de uso (PromoRedemption),
 *   que es lo que mide cuánto vendió y descontó cada código o promotor.
 */
import {
  currentPrice,
  isValidPromoCode,
  normalizePromoCode,
  orderTotals,
  promoDiscount,
  type PromoLine,
} from "@ticketera/core";
import { prisma } from "../client";
import type { PromoCode, PromoDiscountType } from "../generated/prisma/client";
import { DomainError, audit, isUniqueViolation, type Db, type Tx } from "./shared";

const COUNTED = (now: Date) => ({
  OR: [
    { status: { in: ["PAID", "PARTIALLY_REFUNDED"] as ("PAID" | "PARTIALLY_REFUNDED")[] } },
    { status: "PENDING_PAYMENT" as const, expiresAt: { gt: now } },
  ],
});

/** Línea de la compra que se usa para calcular el descuento. */
export type PromoOrderLine = PromoLine & { ticketTypeId: string };

/**
 * Valida el código para esta compra y calcula su descuento. Lanza DomainError("PROMO_INVALID") con el
 * motivo que se le muestra a la persona. Con `lock` (dentro de la transacción de la orden) bloquea la
 * fila del código mientras se cuentan los usos.
 */
export async function resolvePromo(
  db: Db | Tx,
  input: {
    code: string;
    organizationId: string;
    eventId: string;
    customerId?: string | null;
    lines: PromoOrderLine[];
    now: Date;
    lock?: boolean;
  },
): Promise<{ promo: PromoCode; discount: number }> {
  const code = normalizePromoCode(input.code);
  const invalid = (message: string) => new DomainError("PROMO_INVALID", message);
  if (!isValidPromoCode(code)) throw invalid("Ese código no es válido.");

  const promo = await db.promoCode.findFirst({ where: { organizationId: input.organizationId, code } });
  if (!promo || (promo.eventId && promo.eventId !== input.eventId)) throw invalid("Ese código no existe o no aplica a este evento.");
  if (input.lock) await (db as Tx).$queryRaw`SELECT id FROM "PromoCode" WHERE id = ${promo.id} FOR UPDATE`;

  if (!promo.active) throw invalid("Ese código ya no está activo.");
  if (promo.startsAt && promo.startsAt > input.now) throw invalid("Ese código todavía no empieza.");
  if (promo.endsAt && promo.endsAt <= input.now) throw invalid("Ese código venció.");

  if (promo.maxUses !== null) {
    const used = await db.promoRedemption.count({ where: { promoCodeId: promo.id, order: COUNTED(input.now) } });
    if (used >= promo.maxUses) throw invalid("Ese código ya se usó todas las veces posibles.");
  }
  if (promo.maxUsesPerCustomer !== null && input.customerId) {
    const mine = await db.promoRedemption.count({
      where: { promoCodeId: promo.id, customerId: input.customerId, order: COUNTED(input.now) },
    });
    if (mine >= promo.maxUsesPerCustomer) {
      throw invalid(promo.maxUsesPerCustomer === 1 ? "Ya usaste este código." : `Ya usaste este código ${promo.maxUsesPerCustomer} veces.`);
    }
  }

  const discount = promoDiscount(input.lines, {
    discountType: promo.discountType,
    discountValue: promo.discountValue,
    combinableWithPresale: promo.combinableWithPresale,
  });
  if (discount <= 0) throw invalid("Ese código no aplica a las entradas que elegiste (por ejemplo, ya tienen precio de preventa).");
  return { promo, discount };
}

/**
 * Vista previa del descuento para el checkout, sin reservar nada: valida el código con lo que la persona
 * eligió y devuelve cuánto se descuenta. Al reservar se valida otra vez (puede haber cambiado).
 */
export async function previewPromo(input: {
  sessionId: string;
  items: { ticketTypeId: string; quantity: number }[];
  code: string;
  customerId?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const types = await prisma.ticketType.findMany({
    where: { id: { in: input.items.map((i) => i.ticketTypeId) }, sessionId: input.sessionId },
    include: { session: { include: { event: { select: { id: true, organizationId: true } } } } },
  });
  if (types.length === 0 || input.items.length === 0) throw new DomainError("PROMO_INVALID", "Elige tus entradas y vuelve a aplicar el código.");
  const byId = new Map(types.map((t) => [t.id, t]));
  const lines: PromoOrderLine[] = input.items.flatMap((i) => {
    const t = byId.get(i.ticketTypeId);
    if (!t || i.quantity < 1) return [];
    const price = currentPrice(t, now);
    return [{ ticketTypeId: t.id, unitAmount: price.unitAmount, quantity: i.quantity, presaleDiscountActive: price.discountPercent !== null }];
  });
  const event = types[0]!.session.event;
  const { promo, discount } = await resolvePromo(prisma, {
    code: input.code,
    organizationId: event.organizationId,
    eventId: event.id,
    customerId: input.customerId,
    lines,
    now,
  });
  const totals = orderTotals(lines, discount);
  return { code: promo.code, description: promo.description, discountType: promo.discountType, discountValue: promo.discountValue, ...totals };
}

// ───────────────────────── Administración (panel) ─────────────────────────

export type PromoInput = {
  code: string;
  description?: string;
  eventId?: string | null;
  discountType: PromoDiscountType;
  discountValue: number;
  combinableWithPresale?: boolean;
  maxUses?: number | null;
  maxUsesPerCustomer?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  promoterName?: string | null;
  commissionPercent?: number | null;
};

function checkInput(input: PromoInput) {
  const fail = (message: string) => new DomainError("PROMO_INVALID", message);
  if (!isValidPromoCode(normalizePromoCode(input.code))) throw fail("El código debe tener de 3 a 24 letras, números, guiones o guion bajo.");
  if (input.discountType === "PERCENT" && !(Number.isInteger(input.discountValue) && input.discountValue >= 1 && input.discountValue <= 100)) {
    throw fail("El porcentaje debe ser un número entero de 1 a 100.");
  }
  if (input.discountType === "FIXED" && !(Number.isInteger(input.discountValue) && input.discountValue >= 1)) throw fail("El monto del descuento debe ser mayor que cero.");
  if (input.maxUses != null && input.maxUses < 1) throw fail("El máximo de usos debe ser al menos 1.");
  if (input.maxUsesPerCustomer != null && input.maxUsesPerCustomer < 1) throw fail("El máximo por persona debe ser al menos 1.");
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw fail("El código tiene que terminar después de empezar.");
  if (input.commissionPercent != null && (input.commissionPercent < 0 || input.commissionPercent > 100)) throw fail("La comisión debe estar entre 0 y 100%.");
}

export async function createPromoCode(organizationId: string, input: PromoInput, actorId: string) {
  checkInput(input);
  if (input.eventId) {
    const event = await prisma.event.findFirst({ where: { id: input.eventId, organizationId }, select: { id: true } });
    if (!event) throw new DomainError("NOT_FOUND", "Evento no encontrado.");
  }
  try {
    const promo = await prisma.promoCode.create({
      data: {
        organizationId,
        eventId: input.eventId ?? null,
        code: normalizePromoCode(input.code),
        description: input.description?.trim() || null,
        discountType: input.discountType,
        discountValue: input.discountValue,
        combinableWithPresale: input.combinableWithPresale ?? false,
        maxUses: input.maxUses ?? null,
        maxUsesPerCustomer: input.maxUsesPerCustomer ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        promoterName: input.promoterName?.trim() || null,
        commissionPercent: input.commissionPercent ?? null,
        createdById: actorId,
      },
    });
    await audit(prisma, { actorType: "staff", actorId, action: "promo.create", entity: "PromoCode", entityId: promo.id, data: { code: promo.code } });
    return promo;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("DUPLICATE", "Ya existe un código igual en esta organización.");
    throw error;
  }
}

/**
 * Cambia límites, vigencia y promotor de un código. El código y el descuento ya no se editan si tiene usos:
 * cambiar el descuento a mitad de campaña haría inconsistentes los reportes.
 */
export async function updatePromoCode(
  organizationId: string,
  promoId: string,
  input: Pick<PromoInput, "description" | "maxUses" | "maxUsesPerCustomer" | "startsAt" | "endsAt" | "promoterName" | "commissionPercent" | "combinableWithPresale">,
  actorId: string,
) {
  const promo = await prisma.promoCode.findFirst({ where: { id: promoId, organizationId } });
  if (!promo) throw new DomainError("NOT_FOUND", "Código no encontrado.");
  checkInput({ ...input, code: promo.code, discountType: promo.discountType, discountValue: promo.discountValue });
  const updated = await prisma.promoCode.update({
    where: { id: promo.id },
    data: {
      description: input.description?.trim() || null,
      maxUses: input.maxUses ?? null,
      maxUsesPerCustomer: input.maxUsesPerCustomer ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      promoterName: input.promoterName?.trim() || null,
      commissionPercent: input.commissionPercent ?? null,
      combinableWithPresale: input.combinableWithPresale ?? promo.combinableWithPresale,
    },
  });
  await audit(prisma, { actorType: "staff", actorId, action: "promo.update", entity: "PromoCode", entityId: promo.id });
  return updated;
}

export async function setPromoActive(organizationId: string, promoId: string, active: boolean, actorId: string) {
  const { count } = await prisma.promoCode.updateMany({ where: { id: promoId, organizationId }, data: { active } });
  if (count !== 1) throw new DomainError("NOT_FOUND", "Código no encontrado.");
  await audit(prisma, { actorType: "staff", actorId, action: active ? "promo.activate" : "promo.deactivate", entity: "PromoCode", entityId: promoId });
}

/** Cuánto vendió y descontó un código (solo órdenes pagadas) y cuántos usos tiene vigentes. */
async function promoStats(promoIds: string[], now: Date) {
  const redemptions = await prisma.promoRedemption.findMany({
    where: { promoCodeId: { in: promoIds }, order: COUNTED(now) },
    select: { promoCodeId: true, discountAmount: true, order: { select: { status: true, totalAmount: true, _count: { select: { tickets: true } } } } },
  });
  const stats = new Map<string, { uses: number; paidUses: number; tickets: number; sales: number; discount: number }>();
  for (const r of redemptions) {
    const s = stats.get(r.promoCodeId) ?? { uses: 0, paidUses: 0, tickets: 0, sales: 0, discount: 0 };
    s.uses += 1;
    if (r.order.status === "PAID" || r.order.status === "PARTIALLY_REFUNDED") {
      s.paidUses += 1;
      s.tickets += r.order._count.tickets;
      s.sales += r.order.totalAmount;
      s.discount += r.discountAmount;
    }
    stats.set(r.promoCodeId, s);
  }
  return stats;
}

export type PromoRow = Awaited<ReturnType<typeof listPromoCodes>>[number];

/** Códigos de una organización con sus números. `commission` = comisión del promotor sobre lo vendido (pagado). */
export async function listPromoCodes(organizationId: string, now = new Date()) {
  const promos = await prisma.promoCode.findMany({
    where: { organizationId },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    include: { event: { select: { title: true } } },
  });
  const stats = await promoStats(promos.map((p) => p.id), now);
  return promos.map((p) => {
    const s = stats.get(p.id) ?? { uses: 0, paidUses: 0, tickets: 0, sales: 0, discount: 0 };
    return { ...p, ...s, commission: p.commissionPercent ? Math.round((s.sales * p.commissionPercent) / 100) : 0 };
  });
}

/** Resumen por promotor (RRPP): usos, entradas, ventas, descuentos y comisión de todos sus códigos. */
export function summarizeByPromoter(rows: PromoRow[]) {
  const byPromoter = new Map<string, { promoter: string; codes: number; paidUses: number; tickets: number; sales: number; discount: number; commission: number }>();
  for (const r of rows) {
    if (!r.promoterName) continue;
    const s = byPromoter.get(r.promoterName) ?? { promoter: r.promoterName, codes: 0, paidUses: 0, tickets: 0, sales: 0, discount: 0, commission: 0 };
    s.codes += 1;
    s.paidUses += r.paidUses;
    s.tickets += r.tickets;
    s.sales += r.sales;
    s.discount += r.discount;
    s.commission += r.commission;
    byPromoter.set(r.promoterName, s);
  }
  return [...byPromoter.values()].toSorted((a, b) => b.sales - a.sales);
}

/** Un código con sus usos (quién, cuándo, cuánto descontó) para su pantalla de detalle. */
export async function getPromoDetail(organizationId: string, promoId: string, now = new Date()) {
  const promo = await prisma.promoCode.findFirst({
    where: { id: promoId, organizationId },
    include: { event: { select: { id: true, title: true } } },
  });
  if (!promo) return null;
  const [rows, redemptions] = await Promise.all([
    listPromoCodes(organizationId, now).then((all) => all.find((r) => r.id === promoId)!),
    prisma.promoRedemption.findMany({
      where: { promoCodeId: promoId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { order: { select: { code: true, status: true, buyerName: true, buyerEmail: true, totalAmount: true, currency: true, _count: { select: { tickets: true } } } } },
    }),
  ]);
  return { promo, stats: rows, redemptions };
}
