import { currentPrice, saleState } from "@ticketera/core";
import { prisma, type EventCategory } from "@ticketera/db";

/**
 * Eventos publicados con venta y al menos una función futura, ordenados por la próxima.
 * Los eventos con lista de invitados no se publican en el sitio: se entra solo con invitación.
 */
export async function listPublishedEvents(category?: EventCategory) {
  const now = new Date();
  const events = await prisma.event.findMany({
    // Solo de organizadores activos: uno suspendido deja de mostrarse.
    where: { status: "PUBLISHED", mode: "TICKETING", organization: { status: "ACTIVE" }, ...(category ? { category } : {}) },
    include: {
      sessions: {
        where: { cancelledAt: null, startsAt: { gte: now } },
        orderBy: { startsAt: "asc" },
        include: {
          venue: { select: { name: true, city: true, timezone: true } },
          ticketTypes: {
            select: {
              unitAmount: true,
              currency: true,
              salesStartAt: true,
              salesEndAt: true,
              discountPercent: true,
              discountStartsAt: true,
              discountEndsAt: true,
            },
          },
        },
      },
    },
  });

  return events
    .flatMap((event) => {
      const [next] = event.sessions;
      if (!next) return [];
      // "Desde Bs X": sin contar preventas que ya terminaron.
      // Con el descuento de preventa vigente, si lo hay.
      const prices = event.sessions
        .flatMap((s) => s.ticketTypes)
        .filter((t) => saleState(t) !== "closed")
        .map((t) => ({ ...t, ...currentPrice(t, now) }));
      const minPrice = prices.reduce<(typeof prices)[number] | null>(
        (min, t) => (min === null || t.unitAmount < min.unitAmount ? t : min),
        null,
      );
      return [
        {
          slug: event.slug,
          title: event.title,
          category: event.category,
          imageUrl: event.imageUrl,
          nextSession: next,
          sessionCount: event.sessions.length,
          minPrice,
        },
      ];
    })
    .sort((a, b) => a.nextSession.startsAt.getTime() - b.nextSession.startsAt.getTime());
}

export async function getPublishedEvent(slug: string) {
  return prisma.event.findFirst({
    where: { slug, status: "PUBLISHED", mode: "TICKETING", organization: { status: "ACTIVE" } },
    include: {
      organization: { select: { name: true, isPlatform: true } },
      sessions: {
        where: { cancelledAt: null },
        orderBy: { startsAt: "asc" },
        include: {
          venue: true,
          ticketTypes: { orderBy: { sortOrder: "asc" }, include: { section: true } },
        },
      },
    },
  });
}
