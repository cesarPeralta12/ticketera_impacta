/**
 * Configuración regional: Bolivia (bolivianos, es-BO, hora de La Paz).
 */
export const LOCALE = "es-BO";
export const DEFAULT_CURRENCY = "BOB";
export const DEFAULT_TIMEZONE = "America/La_Paz";

/** Fecha y hora en la zona horaria del recinto, no en la del servidor ni la del navegador. */
export function formatDateTime(date: Date, timeZone: string, locale: string = LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatDate(date: Date, timeZone: string, locale: string = LOCALE): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", day: "numeric", month: "long" }).format(date);
}

export function formatTime(date: Date, timeZone: string, locale: string = LOCALE): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(
    date,
  );
}

/** Desfase (ms) de una zona horaria respecto de UTC en un instante dado. */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Convierte una fecha y hora "de pared" (lo que escribe el organizador en un
 * <input type="datetime-local">, ej. "2026-11-20T21:00") en la zona del recinto
 * al instante UTC correspondiente. Así no depende de la zona horaria del servidor.
 */
export function zonedDateTimeToUtc(local: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new RangeError(`Fecha y hora inválidas: ${local}`);
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Dos pasadas para resolver bien los cambios de horario de verano.
  let utc = wallAsUtc - timeZoneOffsetMs(new Date(wallAsUtc), timeZone);
  utc = wallAsUtc - timeZoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/** Inverso de zonedDateTimeToUtc: valor para precargar un <input type="datetime-local">. */
export function utcToZonedInput(date: Date, timeZone: string): string {
  const shifted = new Date(date.getTime() + timeZoneOffsetMs(date, timeZone));
  return shifted.toISOString().slice(0, 16);
}

/** "Noche Electrónica: Alok Bolivia" -> "noche-electronica-alok-bolivia" */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
