import { describe, expect, it } from "vitest";
import {
  clockBefore,
  describeSessionTimes,
  onlineSalesEnd,
  parseSalesWindow,
  parseSessionTimes,
  sessionTimesInput,
  timeZoneLabel,
} from "./session-times";

const TZ = "America/La_Paz"; // UTC-4 todo el año

describe("parseSessionTimes", () => {
  it("resuelve una noche de boliche: puertas antes, cierre de madrugada al día siguiente", () => {
    const r = parseSessionTimes({ date: "2026-12-19", start: "23:00", doors: "22:00", end: "04:00" }, TZ);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.times.startsAt.toISOString()).toBe("2026-12-20T03:00:00.000Z");
    expect(r.times.doorsOpenAt?.toISOString()).toBe("2026-12-20T02:00:00.000Z");
    expect(r.times.endsAt?.toISOString()).toBe("2026-12-20T08:00:00.000Z"); // domingo 04:00
    expect(r.times.arrivalAt).toBeNull();
  });

  it("puertas de la noche anterior cuando la función empieza pasada la medianoche", () => {
    const r = parseSessionTimes({ date: "2026-12-20", start: "00:30", doors: "23:00" }, TZ);
    expect(r.ok && r.times.doorsOpenAt?.toISOString()).toBe("2026-12-20T03:00:00.000Z"); // sábado 23:00
  });

  it("un teatro que termina el mismo día", () => {
    const r = parseSessionTimes({ date: "2026-11-20", start: "20:00", doors: "19:30", end: "22:30" }, TZ);
    expect(r.ok && r.times.endsAt?.toISOString()).toBe("2026-11-21T02:30:00.000Z");
  });

  it("explica lo que falta o no cuadra", () => {
    expect(parseSessionTimes({ start: "20:00" }, TZ)).toMatchObject({ ok: false, field: "date" });
    expect(parseSessionTimes({ date: "2026-11-20" }, TZ)).toMatchObject({ ok: false, field: "start" });
    expect(parseSessionTimes({ date: "2026-11-20", start: "20:00", end: "20:00" }, TZ)).toMatchObject({ ok: false, field: "end" });
    expect(parseSessionTimes({ date: "2026-11-20", start: "20:00", doors: "25:00" }, TZ)).toMatchObject({ ok: false, field: "doors" });
    expect(parseSessionTimes({ date: "2026-11-20", start: "20:00", doors: "19:00", arrival: "18:30" }, TZ)).toMatchObject({
      ok: false,
      field: "arrival",
    });
  });

  it("puertas después del inicio es un error, no el día anterior", () => {
    expect(parseSessionTimes({ date: "2026-12-19", start: "23:00", doors: "23:30" }, TZ)).toMatchObject({ ok: false, field: "doors" });
    expect(parseSessionTimes({ date: "2026-12-19", start: "23:00", arrival: "23:15" }, TZ)).toMatchObject({ ok: false, field: "arrival" });
  });

  it("ida y vuelta con lo guardado", () => {
    const r = parseSessionTimes({ date: "2026-12-19", start: "23:00", doors: "22:00", arrival: "22:30", end: "04:00" }, TZ);
    if (!r.ok) throw new Error("debía resolver");
    expect(sessionTimesInput(r.times, TZ)).toEqual({ date: "2026-12-19", start: "23:00", doors: "22:00", arrival: "22:30", end: "04:00" });
  });
});

describe("clockBefore", () => {
  it("toma la misma hora si coincide", () => {
    const at = new Date("2026-12-20T03:00:00Z");
    expect(clockBefore(at, "23:00", TZ).toISOString()).toBe(at.toISOString());
  });
});

describe("parseSalesWindow", () => {
  const times = { startsAt: new Date("2026-12-20T03:00:00Z"), endsAt: new Date("2026-12-20T08:00:00Z") };

  it("por defecto: desde que se publica hasta que empieza", () => {
    expect(parseSalesWindow({ open: "publish", close: "start" }, times, TZ)).toEqual({ ok: true, window: { salesStartAt: null, salesEndAt: null } });
  });

  it("unas horas antes del inicio", () => {
    const r = parseSalesWindow({ close: "hours", closeHours: "2" }, times, TZ);
    expect(r.ok && r.window.salesEndAt?.toISOString()).toBe("2026-12-20T01:00:00.000Z");
  });

  it("puede seguir durante la noche, pero no después del fin", () => {
    expect(parseSalesWindow({ close: "date", closeAt: "2026-12-20T01:00" }, times, TZ).ok).toBe(true);
    expect(parseSalesWindow({ close: "date", closeAt: "2026-12-20T05:00" }, times, TZ)).toMatchObject({ ok: false, field: "closeAt" });
  });

  it("no abre después de empezar ni cierra antes de abrir", () => {
    expect(parseSalesWindow({ open: "date", openAt: "2026-12-20T00:00" }, times, TZ)).toMatchObject({ ok: false, field: "openAt" });
    expect(
      parseSalesWindow({ open: "date", openAt: "2026-12-10T10:00", close: "date", closeAt: "2026-12-09T10:00" }, times, TZ),
    ).toMatchObject({ ok: false, field: "closeAt" });
    expect(parseSalesWindow({ close: "hours", closeHours: "0" }, times, TZ)).toMatchObject({ ok: false, field: "closeHours" });
  });

  it("sin hora de fin, como máximo 4 h después del inicio", () => {
    const noEnd = { startsAt: times.startsAt, endsAt: null };
    expect(parseSalesWindow({ close: "date", closeAt: "2026-12-20T02:00" }, noEnd, TZ).ok).toBe(true);
    expect(parseSalesWindow({ close: "date", closeAt: "2026-12-20T04:00" }, noEnd, TZ).ok).toBe(false);
  });
});

describe("cómo se muestra", () => {
  it("una noche que termina al día siguiente", () => {
    const when = describeSessionTimes(
      { startsAt: new Date("2026-12-20T03:00:00Z"), doorsOpenAt: new Date("2026-12-20T02:00:00Z"), endsAt: new Date("2026-12-20T08:00:00Z") },
      TZ,
      "BOLICHE",
    );
    expect(when.day).toBe("sábado, 19 de diciembre");
    expect(when.start).toBe("Empieza la noche 23:00");
    expect(when.doors).toBe("Abren las puertas 22:00");
    expect(when.end).toBe("Termina el domingo 20 a las 04:00");
    expect(when.arrival).toBe("Llega desde las 22:00");
  });

  it("un show que termina el mismo día", () => {
    const when = describeSessionTimes({ startsAt: new Date("2026-11-21T00:00:00Z"), endsAt: new Date("2026-11-21T02:30:00Z") }, TZ, "CONCIERTO");
    expect(when.start).toBe("Empieza el show 20:00");
    expect(when.end).toBe("Termina 22:30");
    expect(when.arrival).toBeNull();
  });

  it("la zona horaria a la vista", () => {
    expect(timeZoneLabel(TZ)).toBe("Hora de Bolivia (UTC-4)");
  });

  it("la venta online sigue hasta lo que diga la función", () => {
    const startsAt = new Date("2026-12-20T03:00:00Z");
    expect(onlineSalesEnd({ startsAt, salesEndAt: null })).toEqual(startsAt);
    const later = new Date("2026-12-20T05:00:00Z");
    expect(onlineSalesEnd({ startsAt, salesEndAt: later })).toEqual(later);
  });
});
