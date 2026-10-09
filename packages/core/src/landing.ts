/**
 * Lógica de la portada pública: qué insignias lleva cada evento (preventa, descuento, últimos lugares…),
 * cuáles se destacan en el carrusel principal y cómo se dice "cuándo". Pura (sin base de datos ni DOM).
 */
import { utcToZonedInput } from "./locale";

/** Lo que la portada sabe de un evento (calculado desde su próxima función). */
export type CardSales = {
  startsAt: Date;
  timeZone: string;
  /** Mayor descuento de preventa vigente (%), con su fecha de fin. */
  discountPercent: number | null;
  discountUntil: Date | null;
  /** Hay una entrada de preventa a la venta, hasta esta fecha (con o sin descuento). */
  presaleUntil: Date | null;
  /** Lugares que quedan hoy en lo que se vende ahora, y el aforo total de esas zonas. */
  left: number;
  capacity: number;
  /** Se vende algo ahora mismo. */
  onSale: boolean;
};

export type BadgeKind = "discount" | "presale" | "low" | "hot" | "soldout" | "soon";
export type Badge = { kind: BadgeKind; text: string };

/** Por debajo de este número de lugares se avisa "últimos lugares". */
export const LOW_STOCK = 20;
/** Con este porcentaje vendido (o más) el evento "se está agotando". */
export const HOT_SOLD_RATIO = 0.7;

const DAY_MS = 24 * 3_600_000;

/** Días de calendario (en la hora del recinto) entre dos instantes: 0 = hoy, 1 = mañana. */
export function calendarDaysUntil(target: Date, now: Date, timeZone: string): number {
  const day = (d: Date) => Date.parse(`${utcToZonedInput(d, timeZone).slice(0, 10)}T00:00:00Z`);
  return Math.round((day(target) - day(now)) / DAY_MS);
}

/** "Hoy", "Mañana", "En 5 días"; null si falta más de dos semanas (ahí se muestra la fecha). */
export function relativeDay(startsAt: Date, now: Date, timeZone: string): string | null {
  const days = calendarDaysUntil(startsAt, now, timeZone);
  if (days < 0) return null;
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  return days <= 14 ? `En ${days} días` : null;
}

/** "Termina hoy", "Termina mañana", "Quedan 5 días" para una preventa o descuento. */
export function endsIn(until: Date, now: Date, timeZone: string): string {
  const days = calendarDaysUntil(until, now, timeZone);
  if (days <= 0) return "Termina hoy";
  if (days === 1) return "Termina mañana";
  return `Quedan ${days} días`;
}

const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "20 oct" en la hora del recinto. */
export function shortDate(date: Date, timeZone: string): string {
  const [, m, d] = utcToZonedInput(date, timeZone).slice(0, 10).split("-").map(Number) as [number, number, number];
  return `${d} ${SHORT_MONTHS[m - 1]}`;
}

/** "lun, 22:00": día de la semana y hora de inicio en la hora del recinto. */
export function weekdayTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-BO", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
}

/** Insignias de un evento, de la más importante a la menos. */
export function salesBadges(card: CardSales, now: Date): Badge[] {
  if (!card.onSale) return card.left === 0 && card.capacity > 0 ? [{ kind: "soldout", text: "Agotado" }] : [];
  const badges: Badge[] = [];
  if (card.discountPercent) {
    badges.push({ kind: "discount", text: `-${card.discountPercent}% preventa` });
  } else if (card.presaleUntil) {
    badges.push({ kind: "presale", text: "Preventa" });
  }
  if (card.left === 0) return [{ kind: "soldout", text: "Agotado" }];
  if (card.left <= LOW_STOCK) badges.push({ kind: "low", text: card.left === 1 ? "¡Último lugar!" : `¡Últimos ${card.left} lugares!` });
  else if (card.capacity > 0 && 1 - card.left / card.capacity >= HOT_SOLD_RATIO) badges.push({ kind: "hot", text: "Se está agotando" });
  const soon = relativeDay(card.startsAt, now, card.timeZone);
  if (soon === "Hoy" || soon === "Mañana") badges.push({ kind: "soon", text: soon });
  return badges;
}

/** Texto de la oferta vigente ("Preventa hasta 20 oct · Quedan 5 días"), o null si no hay. */
export function offerLine(card: CardSales, now: Date): string | null {
  const until = card.discountPercent ? card.discountUntil : card.presaleUntil;
  if (!until) return null;
  return `${card.discountPercent ? "Descuento" : "Preventa"} hasta ${shortDate(until, card.timeZone)} · ${endsIn(until, now, card.timeZone)}`;
}

/**
 * Puntaje para el carrusel principal: lo que más conviene mostrar primero. Una oferta vigente pesa mucho
 * (y más cuanto más grande y más cerca de terminar), luego lo que se está agotando y, a igualdad, lo que
 * pasa antes. Lo agotado o sin venta no se destaca.
 */
export function featuredScore(card: CardSales, now: Date): number {
  if (!card.onSale || card.left === 0) return -1;
  let score = 0;
  if (card.discountPercent) score += 60 + Math.min(card.discountPercent, 50);
  else if (card.presaleUntil) score += 45;
  if (card.discountUntil || card.presaleUntil) {
    const until = (card.discountPercent ? card.discountUntil : card.presaleUntil)!;
    const days = calendarDaysUntil(until, now, card.timeZone);
    if (days >= 0 && days <= 3) score += 10; // "última oportunidad"
  }
  if (card.left <= LOW_STOCK) score += 25;
  else if (card.capacity > 0 && 1 - card.left / card.capacity >= HOT_SOLD_RATIO) score += 20;
  const days = calendarDaysUntil(card.startsAt, now, card.timeZone);
  if (days >= 0) score += Math.max(0, 20 - days); // los próximos 20 días suman hasta 20
  return score;
}

/** Los `n` eventos a destacar, del más al menos conveniente (empate: el que pasa antes). */
export function pickFeatured<T extends CardSales>(cards: T[], now: Date, n = 5): T[] {
  return cards
    .map((c) => ({ c, score: featuredScore(c, now) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.c.startsAt.getTime() - b.c.startsAt.getTime())
    .slice(0, n)
    .map((x) => x.c);
}
