import { DEFAULT_TIMEZONE, utcToZonedInput, zonedDateTimeToUtc } from "@ticketera/core";

/** Inicio del día de hoy en la hora de Bolivia (para "ventas de hoy", "ingresos de hoy"). */
export function startOfToday(timeZone: string = DEFAULT_TIMEZONE) {
  const today = utcToZonedInput(new Date(), timeZone).slice(0, 10);
  return zonedDateTimeToUtc(`${today}T00:00`, timeZone);
}
