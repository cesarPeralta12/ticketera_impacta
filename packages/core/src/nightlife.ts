/**
 * Reglas de boliches (cálculo puro): noches que se repiten cada semana, entradas válidas solo hasta una
 * hora ("free hasta la 01:00") y el saldo de consumo de una mesa o de una entrada con trago.
 */
import { utcToZonedInput, zonedDateTimeToUtc } from "./locale";

/** Días de la semana con 0 = domingo (como Date.getUTCDay). */
export const WEEKDAY_LABEL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;
export const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

/** Semanas que se pueden crear de una vez con "Repetir noches". */
export const MAX_REPEAT_WEEKS = 26;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeOfDay(value: string): boolean {
  return TIME.test(value);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Día de la semana (0 = domingo) de un instante, en la hora del recinto. */
export function localWeekday(date: Date, timeZone: string): number {
  return weekdayOf(utcToZonedInput(date, timeZone).slice(0, 10));
}

/**
 * Hora límite de ingreso de una noche: la primera vez que el reloj del recinto marca `time` después de que
 * empieza. Una noche de las 23:00 con "free hasta la 01:00" vence a la 01:00 del día siguiente; con "hasta
 * las 23:30", ese mismo día.
 */
export function entryDeadline(startsAt: Date, time: string, timeZone: string): Date {
  if (!isTimeOfDay(time)) throw new RangeError(`Hora inválida: ${time}`);
  const day = utcToZonedInput(startsAt, timeZone).slice(0, 10);
  const sameDay = zonedDateTimeToUtc(`${day}T${time}`, timeZone);
  return sameDay > startsAt ? sameDay : zonedDateTimeToUtc(`${addDays(day, 1)}T${time}`, timeZone);
}

/**
 * Noches que se repiten: los días elegidos de las próximas `weeks` semanas después de la noche modelo, a su
 * misma hora (en la hora del recinto). No incluye la noche modelo. Ordenadas.
 */
export function weeklyNights(input: { template: Date; weekdays: number[]; weeks: number; timeZone: string }): Date[] {
  const local = utcToZonedInput(input.template, input.timeZone);
  const day = local.slice(0, 10);
  const time = local.slice(11, 16);
  const weekdays = new Set(input.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  const weeks = Math.min(Math.max(0, Math.floor(input.weeks)), MAX_REPEAT_WEEKS);
  // La hora se escribe en minutos: los segundos de la noche modelo se conservan para que la copia sea exacta.
  const seconds = input.template.getTime() % 60_000;
  const nights: Date[] = [];
  for (let offset = 1; offset <= weeks * 7; offset++) {
    const date = addDays(day, offset);
    if (weekdays.has(weekdayOf(date))) nights.push(new Date(zonedDateTimeToUtc(`${date}T${time}`, input.timeZone).getTime() + seconds));
  }
  return nights;
}

/** Lo que queda de un saldo de consumo. */
export function consumptionLeft(credit: { amount: number; spent: number }): number {
  return Math.max(0, credit.amount - credit.spent);
}

/** Personas que entran con una unidad de un tipo de entrada (una mesa de 6 → 6). */
export function peopleIn(type: { kind?: string; peoplePerUnit?: number | null }): number {
  return type.kind === "TABLE" ? Math.max(1, type.peoplePerUnit ?? 1) : 1;
}

/** "Mesa VIP N° 4": la mesa de una entrada, o null si no es de una mesa. */
export function tableLabel(typeName: string, tableNumber: number | null | undefined): string | null {
  return tableNumber ? `${typeName} N° ${tableNumber}` : null;
}
