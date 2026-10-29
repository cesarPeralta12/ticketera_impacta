import {
  RESERVATION_MINUTES,
  checkTableSelection,
  checkoutSchema,
  commissionFor,
  currentPrice,
  findShortage,
  isSeatedTablesLayout,
  onlineSalesEnd,
  orderTotals,
  phaseStates,
  randomCode,
  remainingByType,
  withPhases,
  type CheckoutInput,
  type PhaseInput,
  type PhaseStock,
  type SaleWindow,
} from "@ticketera/core";
import { prisma } from "../client";
import type { OrderChannel } from "../generated/prisma/client";
import { completeTurn, hasActiveTurn } from "./queue";
import { getHeldSeatIds } from "./holds";
import { resolvePromo } from "./promos";
import { assertCanSell } from "./sales-scope";
import { TX_OPTIONS, type Tx } from "./shared";
import { DomainError, findTakenSeats, loadInventory, lockInventory } from "./shared";

/** Cuántas entradas quedan de cada tipo en una función (sin bloquear: solo para mostrar). */
export async function getSessionAvailability(sessionId: string, now = new Date()) {
  return remainingByType(await loadInventory(prisma, sessionId, now));
}

/** Lo vendido o reservado de cada tipo y lo que le queda (para saber qué fase de venta está activa). */
export async function getSessionStock(sessionId: string, now = new Date()): Promise<PhaseStock> {
  const lines = await loadInventory(prisma, sessionId, now);
  return { used: new Map(lines.map((l) => [l.ticketTypeId, l.used])), remaining: remainingByType(lines) };
}

/** Los precios de una función con sus fases resueltas (ver `withPhases`). Si no tiene fases, no consulta nada. */
export async function withSessionPhases<T extends PhaseInput & SaleWindow>(sessionId: string, types: T[], now = new Date()) {
  const stock = types.some((t) => t.phaseOrder !== null) ? await getSessionStock(sessionId, now) : { used: new Map(), remaining: new Map() };
  return withPhases(types, stock, now);
}

/**
 * Zonas sin asientos (de pie) de una función con su aforo y cuánto queda. Cuenta lo vendido y lo reservado
 * por todos los tipos de entrada de la zona (Preventa + General comparten el mismo aforo).
 */
export async function getZoneAvailability(sessionId: string, now = new Date()) {
  const [lines, sections] = await Promise.all([
    loadInventory(prisma, sessionId, now),
    prisma.section.findMany({
      where: { seatingMode: "GENERAL_ADMISSION", ticketTypes: { some: { sessionId } } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, color: true, capacity: true },
    }),
  ]);
  return sections.map((s) => {
    // En personas: una mesa de 6 ocupa 6 lugares de la zona.
    const sold = lines.filter((l) => l.sectionId === s.id).reduce((sum, l) => sum + l.used * (l.peoplePerUnit ?? 1), 0);
    return { id: s.id, name: s.name, color: s.color, capacity: s.capacity, sold, remaining: Math.max(0, s.capacity - sold) };
  });
}

/** Butacas vendidas o reservadas en una función, para pintar el mapa (solo para mostrar). */
export async function getTakenSeatIds(sessionId: string, now = new Date()) {
  const items = await prisma.orderItem.findMany({
    where: {
      seatId: { not: null },
      ticketType: { sessionId },
      order: {
        OR: [
          { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
          { status: "PENDING_PAYMENT", expiresAt: { gt: now } },
        ],
      },
    },
    select: { seatId: true },
  });
  return new Set(items.map((i) => i.seatId!));
}

/** Horas que la boletería sigue vendiendo después del inicio si la función no tiene hora de fin. */
export const BOX_OFFICE_HOURS_AFTER_START = 4;

/**
 * Hasta cuándo se vende una función: online, hasta que empieza (o hasta el cierre de venta que tenga, que en un
 * boliche puede ser durante la noche); en boletería, también durante el evento (en puerta), hasta que termina.
 */
export function salesCutoff(
  session: { startsAt: Date; endsAt: Date | null; salesEndAt?: Date | null; lastEntryAt?: Date | null },
  channel: OrderChannel,
) {
  const cutoff =
    channel !== "POS"
      ? onlineSalesEnd({ startsAt: session.startsAt, salesEndAt: session.salesEndAt ?? null })
      : (session.endsAt ?? new Date(session.startsAt.getTime() + BOX_OFFICE_HOURS_AFTER_START * 60 * 60_000));
  // Pasado el último ingreso nadie puede entrar: tampoco se vende (ni online ni en caja).
  return session.lastEntryAt && session.lastEntryAt < cutoff ? session.lastEntryAt : cutoff;
}

/** Filtro de Prisma: funciones que todavía se venden online (las que se listan en el sitio). */
export function onlineOnSaleWhere(now: Date) {
  return { OR: [{ salesEndAt: { gt: now } }, { salesEndAt: null, startsAt: { gt: now } }] };
}

/**
 * Crea una orden PENDING_PAYMENT, que es la reserva temporal del inventario.
 *
 * Todo ocurre en una transacción que bloquea los tipos de entrada y sus secciones:
 * si cien personas compran la última entrada (o la misma butaca) al mismo tiempo,
 * se atienden en fila y solo la primera la obtiene.
 *
 * Si la función tiene cola virtual, exige un turno vigente (queueToken) y lo da por
 * terminado al crear la orden, para que pase el siguiente de la fila. La boletería
 * (canal POS) no pasa por la cola: atiende a quien está en la fila física.
 */
/**
 * Fases de venta: de cada precio pedido que es una fase y no es la que se vende ahora, el motivo para rechazarlo. Se
 * llama con el inventario ya bloqueado (lockInventory bloquea la sección): dos compras a la vez no se saltan una fase.
 */
async function activePhaseCheck(tx: Tx, sessionId: string, requested: { id: string; sectionId: string | null; phaseOrder: number | null }[], now: Date) {
  const problems = new Map<string, string>();
  const sections = [...new Set(requested.filter((t) => t.phaseOrder !== null).flatMap((t) => (t.sectionId ? [t.sectionId] : [])))];
  if (sections.length === 0) return problems;
  const phases = await tx.ticketType.findMany({
    where: { sessionId, sectionId: { in: sections }, phaseOrder: { not: null } },
    select: { id: true, name: true, sectionId: true, phaseOrder: true, phaseStartsAt: true },
  });
  const lines = await loadInventory(tx, sessionId, now);
  const states = phaseStates(phases, { used: new Map(lines.map((l) => [l.ticketTypeId, l.used])), remaining: remainingByType(lines) }, now);
  for (const t of requested) {
    const state = states.get(t.id);
    if (!state || state.state === "active") continue;
    const active = phases.find((p) => p.sectionId === t.sectionId && states.get(p.id)?.state === "active");
    const name = phases.find((p) => p.id === t.id)!.name;
    problems.set(
      t.id,
      state.state === "done"
        ? `La fase "${name}" ya terminó${active ? `: ahora se vende "${active.name}"` : ""}.`
        : `La fase "${name}" todavía no empieza${active ? `: primero se vende "${active.name}"` : ""}.`,
    );
  }
  return problems;
}

export async function createPendingOrder(
  input: CheckoutInput,
  options: {
    now?: Date;
    queueToken?: string;
    customerId?: string;
    channel?: OrderChannel;
    issuedById?: string;
    /** Código promocional que escribió el comprador. Si no es válido, la compra se rechaza (no se cobra sin descuento en silencio). */
    promoCode?: string;
    /** Código de una retención: habilita sus butacas apartadas (la boletería no lo necesita). */
    holdCode?: string;
    /** Venta de un promotor (canal PROMOTER): la cuenta que vende, que tiene que tener el evento asignado. */
    promoterId?: string;
    /** WhatsApp del comprador, para mandarle sus entradas. */
    buyerPhone?: string;
  } = {},
) {
  const now = options.now ?? new Date();
  const channel = options.channel ?? "ONLINE";
  const data = checkoutSchema.parse(input);
  const ids = data.items.map((i) => i.ticketTypeId);

  // Comprar online exige cuenta con carnet. Los datos del comprador salen SIEMPRE de la cuenta,
  // nunca de lo que mande el formulario: nadie puede comprar a nombre de otro ni sin identificarse.
  // (En boletería el cajero ingresa el carnet del cliente; las invitaciones no pasan por aquí.)
  if (channel === "ONLINE") {
    if (!options.customerId) throw new DomainError("LOGIN_REQUIRED", "Inicia sesión para comprar tus entradas.");
    const customer = await prisma.customer.findUnique({
      where: { id: options.customerId },
      select: { name: true, email: true, documentId: true, emailVerified: true },
    });
    if (!customer) throw new DomainError("LOGIN_REQUIRED", "Inicia sesión para comprar tus entradas.");
    if (!customer.documentId) {
      throw new DomainError("DOCUMENT_REQUIRED", "Completa tu carnet de identidad en tu cuenta para poder comprar.");
    }
    // Las entradas se envían a este correo: tiene que estar confirmado.
    if (!customer.emailVerified) {
      throw new DomainError("EMAIL_NOT_VERIFIED", "Confirma tu correo para poder comprar: te enviamos un enlace.");
    }
    data.buyer = { name: customer.name, email: customer.email, document: customer.documentId };
  }

  return prisma.$transaction(async (tx) => {
    const session = await tx.eventSession.findUnique({
      where: { id: data.sessionId },
      select: { queueEnabled: true },
    });
    if (
      channel === "ONLINE" &&
      session?.queueEnabled &&
      !(await hasActiveTurn(tx, data.sessionId, options.queueToken, now))
    ) {
      throw new DomainError("QUEUE_REQUIRED", "Tu turno en la fila virtual no está vigente. Vuelve a la fila.");
    }

    await lockInventory(tx, ids);

    const types = await tx.ticketType.findMany({
      where: { id: { in: ids } },
      include: {
        section: true,
        session: { include: { event: { include: { organization: { select: { status: true } } } } } },
      },
    });
    if (types.length !== ids.length) {
      throw new DomainError("INVALID_ITEMS", "Alguna de las entradas elegidas ya no existe.");
    }

    const byId = new Map(types.map((t) => [t.id, t]));
    const phases = await activePhaseCheck(tx, data.sessionId, types, now);
    for (const item of data.items) {
      const type = byId.get(item.ticketTypeId)!;
      const { session } = type;
      if (type.sessionId !== data.sessionId) {
        throw new DomainError("INVALID_ITEMS", "Las entradas deben ser de una misma función.");
      }
      if (session.cancelledAt || session.event.status !== "PUBLISHED" || salesCutoff(session, channel) <= now) {
        throw new DomainError("NOT_ON_SALE", "Esta función no está a la venta.");
      }
      if (session.event.organization.status !== "ACTIVE") {
        throw new DomainError("NOT_ON_SALE", "Este evento no está a la venta.");
      }
      if (session.event.mode === "GUEST_LIST") {
        throw new DomainError("NOT_ON_SALE", "Este evento es solo con lista de invitados: no tiene venta.");
      }
      const opens = [type.salesStartAt, session.salesStartAt].filter((d): d is Date => d !== null);
      const closes = [type.salesEndAt, session.salesEndAt].filter((d): d is Date => d !== null);
      if (opens.some((d) => d > now) || closes.some((d) => d <= now)) {
        throw new DomainError("NOT_ON_SALE", `La venta de "${type.name}" no está abierta.`);
      }
      // Una entrada con horario de ingreso ("free hasta la 01:00") deja de venderse a esa hora.
      if (type.entryUntil && type.entryUntil <= now) {
        throw new DomainError("NOT_ON_SALE", `"${type.name}" ya no se vende: pasó su horario de ingreso.`);
      }
      // Fases de venta: solo se vende la que toca ahora en su sección.
      const phaseProblem = phases.get(type.id);
      if (phaseProblem) throw new DomainError("NOT_ON_SALE", phaseProblem);
      const seated = type.section?.seatingMode === "RESERVED";
      if (seated !== Boolean(item.seatIds)) {
        throw new DomainError(
          "INVALID_ITEMS",
          seated ? `Elige tus butacas para "${type.name}" en el mapa.` : `"${type.name}" no tiene butacas numeradas.`,
        );
      }
      if (item.quantity > type.maxPerOrder) {
        throw new DomainError("INVALID_ITEMS", `Máximo ${type.maxPerOrder} entradas "${type.name}" por compra.`);
      }
    }

    const currencies = new Set(types.map((t) => t.currency));
    if (currencies.size !== 1) {
      throw new DomainError("INVALID_ITEMS", "Las entradas tienen monedas distintas.");
    }

    const seatIds = data.items.flatMap((i) => i.seatIds ?? []);
    if (seatIds.length > 0) {
      const seats = await tx.seat.findMany({ where: { id: { in: seatIds } }, select: { id: true, sectionId: true } });
      const sectionOf = new Map(seats.map((s) => [s.id, s.sectionId]));
      for (const item of data.items) {
        const sectionId = byId.get(item.ticketTypeId)!.sectionId;
        if (item.seatIds?.some((id) => sectionOf.get(id) !== sectionId)) {
          throw new DomainError("INVALID_ITEMS", "Alguna butaca no corresponde a la sección elegida.");
        }
      }
      // Retenciones: lo apartado no se vende en la web, salvo con el código de su retención. La boletería sí lo vende.
      if (channel !== "POS") {
        const held = await getHeldSeatIds(tx, data.sessionId, options.holdCode, seatIds);
        if (held.size > 0) {
          throw new DomainError(
            "SEAT_TAKEN",
            held.size === 1
              ? "Una de tus butacas está apartada y no está a la venta. Elige otra."
              : `${held.size} de tus butacas están apartadas y no están a la venta. Elige otras.`,
          );
        }
      }
      // Mesas con sillas: completa, por silla o de N a M sillas de una misma mesa (según la sección).
      for (const item of data.items) {
        const type = byId.get(item.ticketTypeId)!;
        const layout = type.section?.layout;
        if (!item.seatIds || !isSeatedTablesLayout(layout)) continue;
        const rows = await tx.seat.findMany({ where: { id: { in: item.seatIds } }, select: { row: true } });
        let left: Map<string, number> | undefined;
        if (layout.mode === "WHOLE") {
          const tableSeats = await tx.seat.findMany({
            where: { sectionId: type.sectionId!, row: { in: [...new Set(rows.map((r) => r.row))] } },
            select: { id: true, row: true },
          });
          const takenChairs = new Set(await findTakenSeats(tx, data.sessionId, tableSeats.map((s) => s.id), now));
          left = new Map();
          for (const seat of tableSeats) if (!takenChairs.has(seat.id)) left.set(seat.row, (left.get(seat.row) ?? 0) + 1);
        }
        const problem = checkTableSelection(layout, rows.map((r) => r.row), left);
        if (problem) throw new DomainError("INVALID_ITEMS", problem);
      }
      const taken = await findTakenSeats(tx, data.sessionId, seatIds, now);
      if (taken.length > 0) {
        throw new DomainError(
          "SEAT_TAKEN",
          taken.length === 1
            ? "Una de tus butacas acaba de ser tomada por otra persona. Elige otra."
            : `${taken.length} de tus butacas acaban de ser tomadas por otras personas. Elige otras.`,
        );
      }
    }

    // Entrada gratis (lista free): una por persona en cada noche, contando la que ya tiene o tiene reservada.
    // Va con los tipos de entrada bloqueados, así dos compras a la vez de la misma cuenta no se cuelan.
    if (channel === "ONLINE" && options.customerId) {
      for (const item of data.items) {
        const type = byId.get(item.ticketTypeId)!;
        if (currentPrice(type, now).unitAmount !== 0) continue;
        if (item.quantity > 1) throw new DomainError("INVALID_ITEMS", `"${type.name}" es gratis: una por persona.`);
        const already = await tx.orderItem.count({
          where: {
            ticketTypeId: type.id,
            order: {
              customerId: options.customerId,
              OR: [{ status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, { status: "PENDING_PAYMENT", expiresAt: { gt: now } }],
            },
          },
        });
        if (already > 0) {
          throw new DomainError("INVALID_ITEMS", `Ya tienes tu entrada "${type.name}" para esta noche: es una por persona.`);
        }
      }
    }

    const shortage = findShortage(await loadInventory(tx, data.sessionId, now), data.items);
    if (shortage) {
      throw new DomainError(
        "SOLD_OUT",
        shortage.available === 0
          ? `"${shortage.name}" está agotada.`
          : `Solo quedan ${shortage.available} entradas "${shortage.name}".`,
      );
    }

    // Entrada general: una línea por tipo. Butacas: una línea por butaca.
    const priced = data.items.flatMap((item) => {
      const type = byId.get(item.ticketTypeId)!;
      // El precio lo decide el servidor al crear la orden (descuento de preventa vigente, si hay).
      const line = { ticketTypeId: type.id, unitAmount: currentPrice(type, now).unitAmount, name: type.name };
      return item.seatIds
        ? item.seatIds.map((seatId) => ({ ...line, quantity: 1, seatId }))
        : [{ ...line, quantity: item.quantity }];
    });

    // Código promocional: se valida con la fila del código bloqueada, así dos compras a la vez no gastan el último uso.
    const event = types[0]!.session.event;
    let promo: { id: string; discount: number; promoterId: string | null } | null = null;
    if (options.promoCode?.trim()) {
      const resolved = await resolvePromo(tx, {
        code: options.promoCode,
        organizationId: event.organizationId,
        eventId: event.id,
        customerId: options.customerId,
        now,
        lock: true,
        lines: data.items.map((item) => {
          const type = byId.get(item.ticketTypeId)!;
          const price = currentPrice(type, now);
          return {
            ticketTypeId: type.id,
            unitAmount: price.unitAmount,
            quantity: item.quantity,
            presaleDiscountActive: price.discountPercent !== null,
          };
        }),
      });
      promo = { id: resolved.promo.id, discount: resolved.discount, promoterId: resolved.promo.promoterId };
    }

    // Comisión del promotor: el que vende (canal PROMOTER) o el dueño del código que se usó. Se calcula ahora con la
    // regla de su evento y se guarda en la orden: si después cambia la regla, lo ya vendido no cambia.
    const totals = orderTotals(priced, promo?.discount ?? 0);
    const promoterId = channel === "PROMOTER" ? options.promoterId : promo?.promoterId ?? undefined;
    let commissionAmount = 0;
    if (promoterId) {
      const rule = await tx.promoterAssignment.findUnique({ where: { userId_eventId: { userId: promoterId, eventId: event.id } } });
      if (!rule && channel === "PROMOTER") throw new DomainError("NOT_ON_SALE", "No tienes asignado este evento: pídele a iPass que te lo asigne.");
      const units = priced.reduce((sum, l) => sum + l.quantity, 0);
      if (rule && channel === "PROMOTER") {
        // Solo las funciones que tiene asignadas (con su vigencia) y, si tiene cupo, sin pasarse de él.
        await assertCanSell(tx, { userId: promoterId, organizationId: event.organizationId, session: { id: data.sessionId, eventId: event.id }, now });
        if (rule.quota !== null) {
          const sold = await tx.orderItem.aggregate({
            where: {
              order: {
                promoterId,
                channel: "PROMOTER",
                items: { some: { ticketType: { session: { eventId: event.id } } } },
                OR: [{ status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, { status: "PENDING_PAYMENT", expiresAt: { gt: now } }],
              },
            },
            _sum: { quantity: true },
          });
          const left = rule.quota - (sold._sum.quantity ?? 0);
          if (units > left) {
            throw new DomainError(
              "SOLD_OUT",
              left <= 0 ? `Ya vendiste tu cupo de ${rule.quota} entradas para este evento.` : `Tu cupo para este evento: te quedan ${left} entrada(s).`,
            );
          }
        }
      }
      if (rule) commissionAmount = commissionFor(rule, { totalAmount: totals.totalAmount, units });
    }

    if (options.queueToken) await completeTurn(tx, data.sessionId, options.queueToken, now);

    return tx.order.create({
      data: {
        code: randomCode(),
        channel,
        issuedById: options.issuedById,
        customerId: options.customerId,
        buyerName: data.buyer.name,
        buyerEmail: data.buyer.email,
        buyerDocument: data.buyer.document,
        status: "PENDING_PAYMENT",
        currency: [...currencies][0]!,
        ...totals,
        promoterId,
        commissionAmount,
        buyerPhone: options.buyerPhone?.trim() || null,
        expiresAt: new Date(now.getTime() + RESERVATION_MINUTES * 60_000),
        items: { create: priced },
        promoRedemption: promo
          ? { create: { promoCodeId: promo.id, customerId: options.customerId ?? null, discountAmount: promo.discount } }
          : undefined,
      },
    });
  }, TX_OPTIONS);
}

/**
 * Marca como EXPIRED las órdenes pendientes cuya reserva venció. No es necesario para que
 * el inventario sea correcto (las reservas vencidas ya no cuentan), solo ordena los datos.
 * Si después llega un pago aprobado de una de ellas, se resuelve como pago tardío.
 */
export async function expireStaleOrders(now = new Date()) {
  const { count } = await prisma.order.updateMany({
    where: { status: "PENDING_PAYMENT", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  return count;
}

export async function getOrderByCode(code: string) {
  return prisma.order.findUnique({
    where: { code },
    include: {
      items: {
        include: {
          ticketType: {
            include: {
              session: { include: { event: true, venue: { include: { accessPoints: { include: { sections: { select: { id: true } } } } } } } },
              section: true,
            },
          },
          seat: true,
        },
      },
      payments: { orderBy: { createdAt: "desc" } },
      promoRedemption: { include: { promoCode: { select: { code: true } } } },
      tickets: {
        include: {
          ticketType: { include: { zones: { select: { id: true, name: true } } } },
          seat: { include: { section: true } },
          credit: { select: { code: true, redeemedAt: true, tableNumber: true, amount: true, spent: true, currency: true, seat: { select: { label: true } } } },
        },
        orderBy: { issuedAt: "asc" },
      },
    },
  });
}
