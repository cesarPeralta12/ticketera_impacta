/**
 * Borrar un evento con TODO lo suyo: funciones, precios, órdenes (pagadas o no), pagos, entradas, ingresos en puerta,
 * transferencias, consumos, impresas, importaciones, códigos de descuento y asignaciones. No se puede deshacer.
 *
 * Lo que queda: los pagos de comisión ya entregados a los promotores (es plata que salió; el registro dice cuánto y a
 * quién) y la auditoría. Las fotos subidas no son del evento (son de la organización).
 */
import { prisma } from "../client";

/** Lo que se pierde al borrar el evento: para mostrarlo antes de confirmar. */
export type EventFootprint = {
  sessions: number;
  /** Órdenes de cualquier tipo (web, boletería, promotor, invitaciones, impresas, importadas), pagadas o no. */
  orders: number;
  /** Ventas cobradas: órdenes pagadas con plata (las invitaciones e impresas sin vender van en Bs 0). */
  sales: number;
  /** Lo cobrado en esas ventas (centavos, en la moneda del evento). */
  paidAmount: number;
  tickets: number;
  scans: number;
  promoCodes: number;
};

const ofEvent = (eventId: string) => ({ items: { some: { ticketType: { session: { eventId } } } } });

export async function eventFootprint(eventId: string): Promise<EventFootprint> {
  const [sessions, orders, paid, tickets, scans, promoCodes] = await Promise.all([
    prisma.eventSession.count({ where: { eventId } }),
    prisma.order.count({ where: ofEvent(eventId) }),
    prisma.order.aggregate({ where: { ...ofEvent(eventId), status: "PAID", totalAmount: { gt: 0 } }, _count: true, _sum: { totalAmount: true } }),
    prisma.ticket.count({ where: { session: { eventId } } }),
    prisma.accessScan.count({ where: { session: { eventId } } }),
    prisma.promoCode.count({ where: { eventId } }),
  ]);
  return { sessions, orders, sales: paid._count, paidAmount: paid._sum.totalAmount ?? 0, tickets, scans, promoCodes };
}

/** Tiene historia: ventas, entradas o ingresos (para pedir una confirmación más fuerte). */
export const hasHistory = (f: EventFootprint) => f.orders > 0 || f.tickets > 0 || f.scans > 0;

/**
 * Borra el evento y todo lo relacionado, en una sola transacción (o todo o nada). Va de las hojas hacia el evento:
 * varias tablas no se borran solas en cascada (entradas, lecturas, pagos), justamente para que no se pierdan sin querer.
 */
export async function deleteEventCompletely(eventId: string): Promise<EventFootprint> {
  const footprint = await eventFootprint(eventId);
  await prisma.$transaction(
    async (tx) => {
      const orderIds = (await tx.order.findMany({ where: ofEvent(eventId), select: { id: true } })).map((o) => o.id);
      const ticket = { session: { eventId } };
      // Lecturas de puerta de sus funciones, y las de sus entradas leídas en otra puerta.
      await tx.accessScan.deleteMany({ where: { OR: [{ session: { eventId } }, { ticket }] } });
      await tx.ticketTransfer.deleteMany({ where: { ticket } });
      await tx.ticket.deleteMany({ where: ticket });
      await tx.consumptionCredit.deleteMany({ where: { OR: [{ session: { eventId } }, { orderId: { in: orderIds } }] } });
      await tx.promoRedemption.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { promoCode: { eventId } }] } });
      await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
      await tx.printBatch.deleteMany({ where: { session: { eventId } } });
      // Sus códigos: si quedaran sin evento, valdrían para todos los eventos.
      await tx.promoCode.deleteMany({ where: { eventId } });
      // El resto cae en cascada: funciones, precios, puertas, cajeros, promotores, cola, retenciones, importaciones.
      await tx.event.delete({ where: { id: eventId } });
    },
    { timeout: 120_000 },
  );
  return footprint;
}
