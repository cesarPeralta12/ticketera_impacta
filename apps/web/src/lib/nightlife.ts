import { DEFAULT_TIMEZONE, currentPrice, peopleIn, saleState, utcToZonedInput } from "@ticketera/core";
import { getSessionAvailability, onlineOnSaleWhere, prisma } from "@ticketera/db";

export type When = "hoy" | "finde" | "semana";
export const WHEN_LABEL: Record<When, string> = { hoy: "Hoy", finde: "Este finde", semana: "Próximos 7 días" };

/** Lo que ofrece una noche: mesas, entrada gratis por horario y entradas con trago. */
export type ClubOffer = {
  tables: { name: string; people: number; price: number; consumption: number | null; left: number }[];
  free: { name: string; until: Date } | null;
  drinks: { name: string; price: number; consumption: number }[];
  /** Entrada más barata con precio (sin contar la free). */
  entryFrom: number | null;
};

type OfferType = {
  id: string;
  name: string;
  kind: "ENTRY" | "TABLE";
  peoplePerUnit: number;
  unitAmount: number;
  consumptionAmount: number | null;
  entryUntil: Date | null;
  presale: boolean;
  salesStartAt: Date | null;
  salesEndAt: Date | null;
  discountPercent: number | null;
  discountStartsAt: Date | null;
  discountEndsAt: Date | null;
};

/** Resume los tipos de entrada de una noche que se pueden comprar (o se van a poder) ahora. */
export function clubOffer(types: OfferType[], remaining: Map<string, number>, now = new Date()): ClubOffer {
  const live = types.filter((t) => saleState(t, now) !== "closed" && !(t.entryUntil && t.entryUntil <= now));
  const price = (t: OfferType) => currentPrice(t, now).unitAmount;
  const free = live.find((t) => price(t) === 0 && t.entryUntil);
  const paidEntries = live.filter((t) => t.kind === "ENTRY" && price(t) > 0);
  return {
    tables: live
      .filter((t) => t.kind === "TABLE")
      .map((t) => ({ name: t.name, people: peopleIn(t), price: price(t), consumption: t.consumptionAmount, left: remaining.get(t.id) ?? 0 }))
      .toSorted((a, b) => a.price - b.price),
    free: free ? { name: free.name, until: free.entryUntil! } : null,
    drinks: paidEntries
      .filter((t) => (t.consumptionAmount ?? 0) > 0)
      .map((t) => ({ name: t.name, price: price(t), consumption: t.consumptionAmount! })),
    entryFrom: paidEntries.length ? Math.min(...paidEntries.map(price)) : null,
  };
}

/** Rango de fechas (días en la hora de Bolivia, "YYYY-MM-DD") de cada filtro. */
function whenRange(when: When, now: Date): [string, string] {
  const today = utcToZonedInput(now, DEFAULT_TIMEZONE).slice(0, 10);
  const plus = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  if (when === "hoy") return [today, today];
  if (when === "semana") return [today, plus(6)];
  // Fin de semana: de viernes a domingo (el que está en curso o el próximo).
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const start = weekday === 5 || weekday === 6 || weekday === 0 ? 0 : 5 - weekday;
  return [plus(start), plus((7 - weekday) % 7)];
}

export type ClubCard = {
  slug: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  organizer: string | null;
  venue: { name: string; city: string | null; address: string | null; timezone: string };
  currency: string;
  nights: { id: string; startsAt: Date; left: number }[];
  offer: ClubOffer;
};

/**
 * Boliches publicados con noches por delante, filtrados por ciudad y por cuándo. Cada uno con sus próximas
 * noches y lo que ofrece la primera de ellas.
 */
export async function listClubs(filters: { city?: string; when?: When }) {
  const now = new Date();
  const events = await prisma.event.findMany({
    where: { category: "BOLICHE", status: "PUBLISHED", mode: "TICKETING", organization: { status: "ACTIVE" } },
    include: {
      organization: { select: { name: true, isPlatform: true } },
      sessions: {
        where: { cancelledAt: null, ...onlineOnSaleWhere(now) },
        orderBy: { startsAt: "asc" },
        include: { venue: { select: { name: true, city: true, address: true, timezone: true } }, ticketTypes: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  const cities = [...new Set(events.flatMap((e) => e.sessions.map((s) => s.venue.city).filter((c): c is string => Boolean(c))))].sort();
  const range = filters.when ? whenRange(filters.when, now) : null;
  const city = filters.city?.toLowerCase();

  const clubs = await Promise.all(
    events.map(async (event): Promise<ClubCard | null> => {
      const nights = event.sessions.filter((s) => {
        if (s.ticketTypes.length === 0) return false;
        if (city && s.venue.city?.toLowerCase() !== city) return false;
        if (!range) return true;
        const day = utcToZonedInput(s.startsAt, s.venue.timezone).slice(0, 10);
        return day >= range[0] && day <= range[1];
      });
      const [first] = nights;
      if (!first) return null;
      const shown = nights.slice(0, 8);
      const availability = await Promise.all(shown.map((n) => getSessionAvailability(n.id, now)));
      return {
        slug: event.slug,
        title: event.title,
        description: event.description,
        imageUrl: event.imageUrl,
        organizer: event.organization.isPlatform ? null : event.organization.name,
        venue: first.venue,
        currency: first.ticketTypes[0]!.currency,
        nights: shown.map((n, i) => ({
          id: n.id,
          startsAt: n.startsAt,
          left: n.ticketTypes.filter((t) => saleState(t, now) === "open").reduce((sum, t) => sum + (availability[i]!.get(t.id) ?? 0), 0),
        })),
        offer: clubOffer(first.ticketTypes, availability[0]!, now),
      };
    }),
  );
  return {
    cities,
    clubs: clubs.flatMap((c) => (c ? [c] : [])).sort((a, b) => a.nights[0]!.startsAt.getTime() - b.nights[0]!.startsAt.getTime()),
  };
}
