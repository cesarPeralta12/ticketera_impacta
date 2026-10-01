import { prisma, type EventCategory } from "@ticketera/db";

/** Eventos publicados con al menos una función futura, ordenados por la próxima función. */
export async function listPublishedEvents(category?: EventCategory) {
  const now = new Date();
  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED", ...(category ? { category } : {}) },
    include: {
      sessions: {
        where: { cancelledAt: null, startsAt: { gte: now } },
        orderBy: { startsAt: "asc" },
        include: {
          venue: { select: { name: true, city: true, timezone: true } },
          ticketTypes: { select: { unitAmount: true, currency: true } },
        },
      },
    },
  });

  return events
    .flatMap((event) => {
      const [next] = event.sessions;
      if (!next) return [];
      const prices = event.sessions.flatMap((s) => s.ticketTypes);
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
    where: { slug, status: "PUBLISHED" },
    include: {
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
