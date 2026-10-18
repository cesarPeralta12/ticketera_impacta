import { describe, expect, it } from "vitest";
import { effectiveSaleWindow, inheritsSaleWindow, minAgeLabel, parseProgram, safeMapUrl, whatsappLink, whenWhere } from "./event-info";
import { describeSessionTimes, latestSalesEnd, parseSalesWindow, parseSessionTimes } from "./session-times";

const TZ = "America/La_Paz";

describe("condiciones y contacto", () => {
  it("edad mínima en palabras", () => {
    expect(minAgeLabel(null)).toBe("Todo público");
    expect(minAgeLabel(18)).toBe("Mayores de 18");
  });

  it("WhatsApp boliviano con o sin código de país", () => {
    expect(whatsappLink("7123 4567")).toBe("https://wa.me/59171234567");
    expect(whatsappLink("+591 71234567")).toBe("https://wa.me/59171234567");
    expect(whatsappLink("abc")).toBeNull();
  });

  it("enlace de mapa solo https", () => {
    expect(safeMapUrl("https://maps.app.goo.gl/abc")).toBe("https://maps.app.goo.gl/abc");
    expect(safeMapUrl("http://maps.google.com")).toBeNull();
    expect(safeMapUrl("javascript:alert(1)")).toBeNull();
    expect(safeMapUrl("")).toBeNull();
  });
});

describe("programa", () => {
  it("descarta lo mal escrito y recorta textos largos", () => {
    const items = parseProgram([
      { time: "23:00", name: "DJ Uno", note: "warm up" },
      { time: "25:00", name: "Mal" },
      { time: "01:00", name: "  " },
      { time: "00:30", name: "Headliner".padEnd(100, "!") },
      "basura",
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ time: "23:00", name: "DJ Uno", note: "warm up" });
    expect(items[1]!.name).toHaveLength(80);
    expect(parseProgram(null)).toEqual([]);
  });
});

describe("último ingreso", () => {
  it("se resuelve después del inicio y no puede ser después del fin", () => {
    const ok = parseSessionTimes({ date: "2026-12-19", start: "23:00", end: "04:00", lastEntry: "02:00" }, TZ);
    expect(ok.ok && ok.times.lastEntryAt?.toISOString()).toBe("2026-12-20T06:00:00.000Z");
    const bad = parseSessionTimes({ date: "2026-12-19", start: "23:00", end: "01:00", lastEntry: "02:00" }, TZ);
    expect(bad).toMatchObject({ ok: false, field: "lastEntry" });
    const atStart = parseSessionTimes({ date: "2026-11-20", start: "20:00", lastEntry: "20:00" }, TZ);
    expect(atStart.ok && atStart.times.lastEntryAt?.toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });

  it("la venta online no puede seguir después del último ingreso", () => {
    const times = { startsAt: new Date("2026-12-20T03:00:00Z"), endsAt: new Date("2026-12-20T08:00:00Z"), lastEntryAt: new Date("2026-12-20T06:00:00Z") };
    expect(latestSalesEnd(times)).toEqual(times.lastEntryAt);
    expect(parseSalesWindow({ close: "date", closeAt: "2026-12-20T01:30" }, times, TZ).ok).toBe(true);
    expect(parseSalesWindow({ close: "date", closeAt: "2026-12-20T03:00" }, times, TZ)).toMatchObject({ ok: false, field: "closeAt" });
  });

  it("se muestra al comprador", () => {
    const when = describeSessionTimes({ startsAt: new Date("2026-12-20T03:00:00Z"), lastEntryAt: new Date("2026-12-20T06:00:00Z") }, TZ, "BOLICHE");
    expect(when.lastEntry).toBe("Último ingreso 02:00");
  });
});

describe("ventana de venta heredada", () => {
  const session = { startsAt: new Date("2026-12-20T03:00:00Z"), salesStartAt: new Date("2026-12-01T12:00:00Z"), salesEndAt: null };

  it("una entrada sin fechas propias se vende igual que la función", () => {
    const type = { salesStartAt: null, salesEndAt: null };
    expect(inheritsSaleWindow(type)).toBe(true);
    expect(effectiveSaleWindow(type, session)).toEqual({ salesStartAt: session.salesStartAt, salesEndAt: session.startsAt });
  });

  it("las fechas propias se recortan por las de la función", () => {
    const type = { salesStartAt: new Date("2026-11-20T12:00:00Z"), salesEndAt: new Date("2026-12-10T12:00:00Z") };
    expect(effectiveSaleWindow(type, session)).toEqual({ salesStartAt: session.salesStartAt, salesEndAt: type.salesEndAt });
  });
});

describe("cuándo y dónde", () => {
  it("junta horarios, lugar, condiciones, programa y contacto", () => {
    const ww = whenWhere({
      session: {
        startsAt: new Date("2026-12-20T03:00:00Z"),
        doorsOpenAt: new Date("2026-12-20T02:00:00Z"),
        endsAt: new Date("2026-12-20T08:00:00Z"),
        program: [{ time: "23:30", name: "DJ Uno" }],
      },
      venue: { name: "Club", timezone: TZ, address: "Av. 1", city: "Santa Cruz", mapUrl: "https://maps.app.goo.gl/x", directions: "Puerta lateral" },
      event: { category: "BOLICHE", minAge: 18, requiredDocument: "Carnet de identidad", contactPhone: "71234567", dressCode: " " },
    });
    expect(ww.when.start).toBe("Empieza la noche 23:00");
    expect(ww.place).toMatchObject({ name: "Club", address: "Av. 1, Santa Cruz", directions: "Puerta lateral", mapUrl: "https://maps.app.goo.gl/x" });
    expect(ww.conditions).toEqual(["Mayores de 18", "Documento: Carnet de identidad"]);
    expect(ww.program).toEqual([{ time: "23:30", name: "DJ Uno" }]);
    expect(ww.contact.whatsapp).toBe("https://wa.me/59171234567");
  });
});
