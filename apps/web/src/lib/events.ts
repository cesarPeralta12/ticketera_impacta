import { currentPrice, saleState, type CardSales } from "@ticketera/core";
import { getSessionAvailability, prisma, type EventCategory } from "@ticketera/db";

/** Lo que muestra la portada de cada evento: su próxima función, el precio desde y su estado de venta. */
export type EventCard = {
  slug: string;
  title: string;
  description: string | null;
  category: EventCategory;
  imageUrl: string | null;
  publishedAt: Date | null;
  nextSession: {
    id: string;
    startsAt: Date;
    venue: { name: string; city: string | null; timezone: string };
  };
  sessionCount: number;
  /** Precio más bajo a la venta (con el descuento de preventa vigente, si lo hay). */
  minPrice: { unitAmount: number; currency: string } | null;
  /** Precio normal tachado, solo si el más bajo tiene un descuento vigente. */
  listAmount: number | null;
  /** Estado de venta de la próxima función: preventa, descuento, lugares que quedan. */
  sales: CardSales;
};

/**
 * Eventos publicados con venta y al menos una función futura, ordenados por la próxima.
 * Los eventos con lista de invitados no se publican en el sitio: se entra solo con invitación.
 * `search` filtra por título, recinto o ciudad.
 */
export async function listPublishedEvents(category?: EventCategory, search?: string): Promise<EventCard[]> {
  const now = new Date();
  const term = search?.trim();
  const events = await prisma.event.findMany({
    // Solo de organizadores activos: uno suspendido deja de mostrarse.
    where: {
      status: "PUBLISHED",
      mode: "TICKETING",
      organization: { status: "ACTIVE" },
      ...(category ? { category } : {}),
      ...(term
        ? {
            OR: [
              { title: { contains: term, mode: "insensitive" } },
              { sessions: { some: { venue: { OR: [{ name: { contains: term, mode: "insensitive" } }, { city: { contains: term, mode: "insensitive" } }] } } } },
            ],
          }
        : {}),
    },
    include: {
      sessions: {
        where: { cancelledAt: null, startsAt: { gte: now } },
        orderBy: { startsAt: "asc" },
        include: {
          venue: { select: { name: true, city: true, timezone: true } },
          ticketTypes: {
            select: {
              id: true,
              unitAmount: true,
              currency: true,
              capacity: true,
              presale: true,
              salesStartAt: true,
              salesEndAt: true,
              discountPercent: true,
              discountStartsAt: true,
              discountEndsAt: true,
              sectionId: true,
              section: { select: { id: true, capacity: true } },
            },
          },
        },
      },
    },
  });

  const cards = await Promise.all(
    events.map(async (event): Promise<EventCard | null> => {
      const [next] = event.sessions;
      if (!next) return null;

      // "Desde Bs X": sin contar preventas que ya terminaron, con el descuento vigente si lo hay.
      const prices = event.sessions
        .flatMap((s) => s.ticketTypes)
        .filter((t) => saleState(t, now) !== "closed")
        .map((t) => ({ ...t, ...currentPrice(t, now) }));
      const cheapest = prices.reduce<(typeof prices)[number] | null>((min, t) => (min === null || t.unitAmount < min.unitAmount ? t : min), null);

      // Estado de venta de la próxima función: solo lo que se vende ahora.
      const open = next.ticketTypes.filter((t) => saleState(t, now) === "open");
      const remaining = await getSessionAvailability(next.id, now);
      // Preventa y General de una misma zona comparten aforo: por zona se toma lo que queda, no la suma.
      const zones = new Map<string, { left: number; capacity: number }>();
      for (const t of open) {
        const key = t.sectionId ?? t.id;
        const left = remaining.get(t.id) ?? 0;
        const zone = zones.get(key) ?? { left: 0, capacity: t.section?.capacity ?? t.capacity };
        zones.set(key, { left: Math.max(zone.left, left), capacity: zone.capacity });
      }
      const offers = open.map((t) => ({ t, price: currentPrice(t, now) })).filter((x) => x.price.discountPercent);
      const best = offers.toSorted((a, b) => b.price.discountPercent! - a.price.discountPercent!)[0];
      const presaleEnds = open.flatMap((t) => (t.presale && t.salesEndAt ? [t.salesEndAt] : []));

      return {
        slug: event.slug,
        title: event.title,
        description: event.description,
        category: event.category,
        imageUrl: event.imageUrl,
        publishedAt: event.publishedAt,
        nextSession: { id: next.id, startsAt: next.startsAt, venue: next.venue },
        sessionCount: event.sessions.length,
        minPrice: cheapest ? { unitAmount: cheapest.unitAmount, currency: cheapest.currency } : null,
        listAmount: cheapest?.discountPercent ? cheapest.listAmount : null,
        sales: {
          startsAt: next.startsAt,
          timeZone: next.venue.timezone,
          discountPercent: best?.price.discountPercent ?? null,
          discountUntil: best?.price.discountEndsAt ?? null,
          presaleUntil: presaleEnds.length ? new Date(Math.min(...presaleEnds.map((d) => d.getTime()))) : null,
          left: [...zones.values()].reduce((sum, z) => sum + z.left, 0),
          capacity: [...zones.values()].reduce((sum, z) => sum + z.capacity, 0),
          onSale: open.length > 0,
        },
      };
    }),
  );

  return cards.flatMap((c) => (c ? [c] : [])).sort((a, b) => a.nextSession.startsAt.getTime() - b.nextSession.startsAt.getTime());
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
