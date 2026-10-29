/**
 * Lo que el comprador necesita saber además de la hora (cálculo puro): edad mínima, programa de artistas, contacto
 * por WhatsApp, enlace de mapa y la ventana de venta efectiva de cada entrada (la suya o la de la función).
 */
import { isTimeOfDay } from "./nightlife";
import { describeSessionTimes, onlineSalesEnd, type SessionWhen } from "./session-times";
import type { SaleWindow } from "./sale-window";

// ── Condiciones ──

/** Edades que se ofrecen en el formulario (nula = todo público). */
export const MIN_AGE_OPTIONS = [16, 18, 21] as const;

export function minAgeLabel(minAge: number | null | undefined): string {
  return minAge ? `Mayores de ${minAge}` : "Todo público";
}

/** Texto estándar de cambios y reembolsos, para partir de algo y editarlo. */
export const DEFAULT_REFUND_POLICY =
  "Las entradas no tienen cambio ni devolución, salvo que el evento se cancele o cambie de fecha: en ese caso se devuelve el importe por el mismo medio de pago. Las entradas se pueden transferir a otra cuenta desde Mis entradas.";

// ── Programa ──

export type ProgramItem = { time: string; name: string; note?: string };
export const MAX_PROGRAM_ITEMS = 30;

/** Programa guardado (JSON de la base) o enviado por el formulario, validado. Lo que no cuadra se descarta. */
export function parseProgram(value: unknown): ProgramItem[] {
  if (!Array.isArray(value)) return [];
  const items: ProgramItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const { time, name, note } = raw as Record<string, unknown>;
    if (typeof time !== "string" || !isTimeOfDay(time.trim())) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    const item: ProgramItem = { time: time.trim(), name: name.trim().slice(0, 80) };
    if (typeof note === "string" && note.trim()) item.note = note.trim().slice(0, 120);
    items.push(item);
    if (items.length === MAX_PROGRAM_ITEMS) break;
  }
  return items;
}

// ── Contacto y mapa ──

/**
 * Enlace de WhatsApp para un número boliviano (8 dígitos) o con código de país, con un mensaje listo para enviar si
 * se pasa `text`. Null si no parece un número.
 */
export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  const full = digits.length === 8 ? `591${digits}` : digits;
  return text ? `https://wa.me/${full}?text=${encodeURIComponent(text)}` : `https://wa.me/${full}`;
}

/** Solo enlaces https (Google Maps, OpenStreetMap…): nada de javascript: ni http sin cifrar. */
export function safeMapUrl(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// ── Venta ──

/**
 * Ventana de venta online efectiva de una entrada: la suya, recortada por la de la función. Una entrada sin fechas
 * propias se vende "igual que la función".
 */
export function effectiveSaleWindow(
  type: SaleWindow,
  session: { startsAt: Date; salesStartAt: Date | null; salesEndAt: Date | null },
): SaleWindow {
  const starts = [type.salesStartAt, session.salesStartAt].filter((d): d is Date => d !== null);
  const sessionEnd = onlineSalesEnd(session);
  const ends = [type.salesEndAt, sessionEnd].filter((d): d is Date => d !== null);
  return {
    salesStartAt: starts.length ? new Date(Math.max(...starts.map((d) => d.getTime()))) : null,
    salesEndAt: ends.length ? new Date(Math.min(...ends.map((d) => d.getTime()))) : null,
  };
}

/** La entrada usa las fechas de la función (no tiene propias). */
export function inheritsSaleWindow(type: SaleWindow): boolean {
  return type.salesStartAt === null && type.salesEndAt === null;
}

// ── "Cuándo y dónde": lo mismo en la web, la entrada, el correo, la boletería y el PDF ──

export type WhenWhereInput = {
  session: {
    startsAt: Date;
    doorsOpenAt?: Date | null;
    arrivalAt?: Date | null;
    endsAt?: Date | null;
    lastEntryAt?: Date | null;
    program?: unknown;
  };
  venue: {
    name: string;
    timezone: string;
    address?: string | null;
    city?: string | null;
    directions?: string | null;
    mapUrl?: string | null;
    parking?: string | null;
    accessibility?: string | null;
  };
  event: {
    category: string;
    minAge?: number | null;
    requiredDocument?: string | null;
    dressCode?: string | null;
    forbiddenItems?: string | null;
    reentryPolicy?: string | null;
    refundPolicy?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
  };
};

export type WhenWhere = {
  when: SessionWhen;
  timeZone: string;
  place: {
    name: string;
    /** "Av. Principal 123, Santa Cruz" */
    address: string | null;
    directions: string | null;
    mapUrl: string | null;
    parking: string | null;
    accessibility: string | null;
  };
  /** "Mayores de 18", "Documento: Carnet de identidad", "Vestimenta: …", "No se permite: …", "Reingreso: …" */
  conditions: string[];
  program: ProgramItem[];
  refundPolicy: string | null;
  contact: { phone: string | null; whatsapp: string | null; email: string | null };
};

/** Arma el bloque "Cuándo y dónde" de una función (solo textos: se puede mandar al navegador o a un correo). */
export function whenWhere(input: WhenWhereInput): WhenWhere {
  const { session, venue, event } = input;
  const clean = (v: string | null | undefined) => v?.trim() || null;
  const conditions = [
    event.minAge ? minAgeLabel(event.minAge) : null,
    clean(event.requiredDocument) && `Documento: ${clean(event.requiredDocument)}`,
    clean(event.dressCode) && `Vestimenta: ${clean(event.dressCode)}`,
    clean(event.forbiddenItems) && `No se permite: ${clean(event.forbiddenItems)}`,
    clean(event.reentryPolicy) && `Reingreso: ${clean(event.reentryPolicy)}`,
  ].filter((c): c is string => Boolean(c));
  const phone = clean(event.contactPhone);
  return {
    when: describeSessionTimes(session, venue.timezone, event.category),
    timeZone: venue.timezone,
    place: {
      name: venue.name,
      address: [clean(venue.address), clean(venue.city)].filter(Boolean).join(", ") || null,
      directions: clean(venue.directions),
      mapUrl: safeMapUrl(venue.mapUrl),
      parking: clean(venue.parking),
      accessibility: clean(venue.accessibility),
    },
    conditions,
    program: parseProgram(session.program),
    refundPolicy: clean(event.refundPolicy),
    contact: { phone, whatsapp: whatsappLink(phone), email: clean(event.contactEmail) },
  };
}
