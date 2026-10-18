/**
 * Horarios de una función o noche (cálculo puro). Se cargan como una fecha y horas del reloj del recinto, y se
 * resuelven solos: las puertas y la llegada son antes del inicio, y el fin después (si es de madrugada, al día
 * siguiente). Así nadie tiene que pensar "¿el cierre de las 04:00 es el sábado o el domingo?".
 */
import { LOCALE, utcToZonedInput, zonedDateTimeToUtc } from "./locale";
import { entryDeadline, isTimeOfDay } from "./nightlife";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SessionTimesInput = {
  /** Día en que empieza (AAAA-MM-DD, en la hora del recinto). */
  date?: string;
  /** Horas "HH:MM" del reloj del recinto. */
  start?: string;
  doors?: string;
  arrival?: string;
  end?: string;
  /** Última hora de ingreso: después de empezar (de madrugada, al día siguiente). */
  lastEntry?: string;
};

export type SessionTimes = {
  startsAt: Date;
  doorsOpenAt: Date | null;
  arrivalAt: Date | null;
  endsAt: Date | null;
  lastEntryAt: Date | null;
};

export type SessionTimesField = "date" | "start" | "doors" | "arrival" | "end" | "lastEntry";

/** Las puertas y la llegada son como mucho esto antes del inicio: más, es un error de tipeo (ej. 23:30 con inicio 23:00). */
export const MAX_HOURS_BEFORE_START = 12;
export type TimesResult = { ok: true; times: SessionTimes } | { ok: false; field: SessionTimesField; message: string };

function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** La última vez que el reloj del recinto marca `time` hasta `at` (inclusive): puertas y llegada. */
export function clockBefore(at: Date, time: string, timeZone: string): Date {
  if (!isTimeOfDay(time)) throw new RangeError(`Hora inválida: ${time}`);
  const day = utcToZonedInput(at, timeZone).slice(0, 10);
  const sameDay = zonedDateTimeToUtc(`${day}T${time}`, timeZone);
  return sameDay <= at ? sameDay : zonedDateTimeToUtc(`${previousDay(day)}T${time}`, timeZone);
}

/** Lee la fecha y las horas del formulario y las convierte en instantes, con un mensaje claro si algo falta. */
export function parseSessionTimes(input: SessionTimesInput, timeZone: string): TimesResult {
  if (!input.date || !DATE.test(input.date)) return { ok: false, field: "date", message: "Elige el día." };
  if (!input.start || !isTimeOfDay(input.start)) return { ok: false, field: "start", message: "Escribe a qué hora empieza (ej. 23:00)." };
  for (const field of ["doors", "arrival", "end", "lastEntry"] as const) {
    const value = input[field];
    if (value && !isTimeOfDay(value)) return { ok: false, field, message: `Hora inválida: ${value} (ej. 22:00).` };
  }
  let startsAt: Date;
  try {
    startsAt = zonedDateTimeToUtc(`${input.date}T${input.start}`, timeZone);
  } catch {
    return { ok: false, field: "date", message: "Fecha inválida." };
  }
  if (input.end && input.end === input.start) {
    return { ok: false, field: "end", message: "Termina a la misma hora que empieza: revisa la hora de fin (o déjala vacía)." };
  }
  const doorsOpenAt = input.doors ? clockBefore(startsAt, input.doors, timeZone) : null;
  const arrivalAt = input.arrival ? clockBefore(startsAt, input.arrival, timeZone) : null;
  const endsAt = input.end ? entryDeadline(startsAt, input.end, timeZone) : null;
  // A la misma hora que empieza = no entra nadie después de empezar (ej. teatro con puertas cerradas al inicio).
  const lastEntryAt = input.lastEntry ? (input.lastEntry === input.start ? startsAt : entryDeadline(startsAt, input.lastEntry, timeZone)) : null;
  const tooEarly = (d: Date | null) => d !== null && startsAt.getTime() - d.getTime() > MAX_HOURS_BEFORE_START * 3_600_000;
  if (tooEarly(doorsOpenAt)) {
    return { ok: false, field: "doors", message: `Las puertas abren a las ${input.doors}, después de que empieza (${input.start}). Revisa la hora.` };
  }
  if (tooEarly(arrivalAt)) {
    return { ok: false, field: "arrival", message: `La llegada (${input.arrival}) es después de que empieza (${input.start}): pide llegar antes.` };
  }
  if (doorsOpenAt && arrivalAt && arrivalAt < doorsOpenAt) {
    return {
      ok: false,
      field: "arrival",
      message: `Pides llegar a las ${input.arrival}, antes de que abran las puertas (${input.doors}). Revisa la hora.`,
    };
  }
  if (lastEntryAt && endsAt && lastEntryAt > endsAt) {
    return {
      ok: false,
      field: "lastEntry",
      message: `El último ingreso (${input.lastEntry}) es después de que termina (${input.end}): esa hora ya no permite entrar a nadie.`,
    };
  }
  return { ok: true, times: { startsAt, doorsOpenAt, arrivalAt, endsAt, lastEntryAt } };
}

/** Valores del formulario a partir de una función guardada (para editarla). */
export function sessionTimesInput(session: Partial<SessionTimes> & { startsAt: Date }, timeZone: string): SessionTimesInput {
  const clock = (d: Date | null | undefined) => (d ? utcToZonedInput(d, timeZone).slice(11, 16) : undefined);
  return {
    date: utcToZonedInput(session.startsAt, timeZone).slice(0, 10),
    start: clock(session.startsAt),
    doors: clock(session.doorsOpenAt),
    arrival: clock(session.arrivalAt),
    end: clock(session.endsAt),
    lastEntry: clock(session.lastEntryAt),
  };
}

/** Horarios sugeridos al crear, según el tipo de evento. Siempre se pueden cambiar. */
export function suggestedTimes(category: string): Omit<SessionTimesInput, "date"> {
  if (category === "BOLICHE") return { doors: "22:00", start: "23:00", end: "04:00" };
  if (category === "TEATRO") return { doors: "19:30", start: "20:00" };
  return { doors: "19:00", start: "20:00" };
}

/** Cómo se llama lo que empieza: un boliche no tiene "show", tiene una noche que abre. */
export function startLabel(category: string): string {
  if (category === "BOLICHE") return "Empieza la noche";
  if (category === "TEATRO") return "Empieza la función";
  return "Empieza el show";
}

/** Una sola palabra por concepto: en boliches cada función es una "noche". */
export function sessionNoun(category: string) {
  return category === "BOLICHE"
    ? { one: "noche", many: "noches", One: "Noche", Many: "Noches", the: "la noche", The: "La noche", a: "una noche" }
    : { one: "función", many: "funciones", One: "Función", Many: "Funciones", the: "la función", The: "La función", a: "una función" };
}

// ── Venta de la función ──

/** Horas antes del inicio que se puede cerrar la venta online con "unas horas antes". */
export const MAX_CLOSE_HOURS_BEFORE = 72;
/** Si la función no tiene hora de fin, la venta online puede seguir como máximo esto después del inicio. */
export const SALES_AFTER_START_HOURS = 4;

export type SalesInput = {
  /** "publish" = desde que se publica; "date" = en una fecha. */
  open?: string;
  openAt?: string;
  /** "start" = cuando empieza; "hours" = unas horas antes; "date" = en una fecha (puede ser durante la noche). */
  close?: string;
  closeHours?: string;
  closeAt?: string;
};
export type SalesWindow = { salesStartAt: Date | null; salesEndAt: Date | null };
export type SalesField = "openAt" | "closeHours" | "closeAt";
export type SalesResult = { ok: true; window: SalesWindow } | { ok: false; field: SalesField; message: string };

type SalesTimes = { startsAt: Date; endsAt: Date | null; lastEntryAt?: Date | null };

/**
 * Hasta cuándo puede seguir la venta de una función: el último ingreso (después nadie puede entrar), si no su fin, o
 * unas horas después del inicio.
 */
export function latestSalesEnd(times: SalesTimes): Date {
  const end = times.endsAt ?? new Date(times.startsAt.getTime() + SALES_AFTER_START_HOURS * 3_600_000);
  return times.lastEntryAt && times.lastEntryAt < end ? times.lastEntryAt : end;
}

/** Lee "Abre la venta" y "Cierra la venta" del formulario, en la hora del recinto. */
export function parseSalesWindow(input: SalesInput, times: SalesTimes, timeZone: string): SalesResult {
  const local = (value: string | undefined, field: SalesField): Date | SalesResult => {
    if (!value) return { ok: false, field, message: "Elige la fecha y la hora." };
    try {
      return zonedDateTimeToUtc(value, timeZone);
    } catch {
      return { ok: false, field, message: "Fecha inválida." };
    }
  };
  let salesStartAt: Date | null = null;
  if (input.open === "date") {
    const parsed = local(input.openAt, "openAt");
    if (!(parsed instanceof Date)) return parsed;
    salesStartAt = parsed;
  }
  let salesEndAt: Date | null = null;
  if (input.close === "hours") {
    const hours = Number(input.closeHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_CLOSE_HOURS_BEFORE) {
      return { ok: false, field: "closeHours", message: `Escribe cuántas horas antes (de 1 a ${MAX_CLOSE_HOURS_BEFORE}).` };
    }
    salesEndAt = new Date(times.startsAt.getTime() - hours * 3_600_000);
  } else if (input.close === "date") {
    const parsed = local(input.closeAt, "closeAt");
    if (!(parsed instanceof Date)) return parsed;
    salesEndAt = parsed;
  }
  if (salesStartAt && salesStartAt >= times.startsAt) {
    return { ok: false, field: "openAt", message: "La venta abre después de que empieza: revisa la fecha." };
  }
  if (salesStartAt && salesEndAt && salesEndAt <= salesStartAt) {
    return { ok: false, field: input.close === "hours" ? "closeHours" : "closeAt", message: "La venta cierra antes de abrir." };
  }
  if (salesEndAt && salesEndAt > latestSalesEnd(times)) {
    return {
      ok: false,
      field: "closeAt",
      message:
        times.lastEntryAt && times.lastEntryAt.getTime() === latestSalesEnd(times).getTime()
          ? "La venta termina después del último ingreso: nadie podría entrar con esa entrada."
          : times.endsAt
            ? "La venta termina después de que el evento acabó."
            : `La venta termina más de ${SALES_AFTER_START_HOURS} h después de que empieza: pon la hora de fin o una fecha anterior.`,
    };
  }
  return { ok: true, window: { salesStartAt, salesEndAt } };
}

/** Hasta cuándo se puede comprar online: lo que diga la función, o hasta que empieza. */
export function onlineSalesEnd(session: { startsAt: Date; salesEndAt: Date | null }): Date {
  return session.salesEndAt ?? session.startsAt;
}

// ── Cómo se muestra ──

/** "Hora de Bolivia (UTC-4)": junto a cada fecha, para que nadie la confunda con la del celular. */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  const place = timeZone === "America/La_Paz" ? "Bolivia" : (timeZone.split("/").at(-1) ?? timeZone).replaceAll("_", " ");
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")
      ?.value ?? "";
  const utc = offset === "GMT" ? "UTC" : offset.replace("GMT", "UTC");
  return `Hora de ${place}${utc ? ` (${utc})` : ""}`;
}

function clockText(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function dayKey(date: Date, timeZone: string): string {
  return utcToZonedInput(date, timeZone).slice(0, 10);
}

export type SessionWhen = {
  /** "sábado, 20 de diciembre" */
  day: string;
  /** "Abren las puertas 22:00" */
  doors: string | null;
  /** "Empieza la noche 23:00" */
  start: string;
  /** "Termina el domingo 21 a las 04:00" o "Termina 22:30" */
  end: string | null;
  /** "Llega desde las 22:00" (si no hay hora de llegada, la de las puertas) */
  arrival: string | null;
  /** "Último ingreso 02:00" */
  lastEntry: string | null;
};

/** Los horarios de una función en palabras, para la web, la entrada y el correo. */
export function describeSessionTimes(
  session: { startsAt: Date; doorsOpenAt?: Date | null; arrivalAt?: Date | null; endsAt?: Date | null; lastEntryAt?: Date | null },
  timeZone: string,
  category: string,
): SessionWhen {
  const day = new Intl.DateTimeFormat(LOCALE, { timeZone, weekday: "long", day: "numeric", month: "long" }).format(session.startsAt);
  let end: string | null = null;
  if (session.endsAt) {
    end =
      dayKey(session.endsAt, timeZone) === dayKey(session.startsAt, timeZone)
        ? `Termina ${clockText(session.endsAt, timeZone)}`
        : `Termina el ${new Intl.DateTimeFormat(LOCALE, { timeZone, weekday: "long", day: "numeric" }).format(session.endsAt)} a las ${clockText(session.endsAt, timeZone)}`;
  }
  const arrive = session.arrivalAt ?? session.doorsOpenAt ?? null;
  return {
    day,
    doors: session.doorsOpenAt ? `Abren las puertas ${clockText(session.doorsOpenAt, timeZone)}` : null,
    start: `${startLabel(category)} ${clockText(session.startsAt, timeZone)}`,
    end,
    arrival: arrive ? `Llega desde las ${clockText(arrive, timeZone)}` : null,
    lastEntry: session.lastEntryAt ? `Último ingreso ${clockText(session.lastEntryAt, timeZone)}` : null,
  };
}
