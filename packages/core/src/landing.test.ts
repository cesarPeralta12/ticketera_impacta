import { describe, expect, it } from "vitest";
import { calendarDaysUntil, endsIn, featuredScore, offerLine, pickFeatured, relativeDay, salesBadges, shortDate, weekdayTime, type CardSales } from "./landing";

const TZ = "America/La_Paz"; // UTC-4
const NOW = new Date("2026-10-09T15:00:00Z"); // 11:00 en La Paz
const day = (n: number, hourUtc = 23) => new Date(Date.UTC(2026, 9, 9 + n, hourUtc));

const base: CardSales = { startsAt: day(10), timeZone: TZ, discountPercent: null, discountUntil: null, presaleUntil: null, left: 500, capacity: 1000, onSale: true };

describe("fechas relativas (hora del recinto)", () => {
  it("cuenta días de calendario, no de 24 horas", () => {
    // 23:00 UTC del 9 de oct = 19:00 del 9 en La Paz: hoy.
    expect(calendarDaysUntil(day(0), NOW, TZ)).toBe(0);
    // 02:00 UTC del 10 = 22:00 del 9 en La Paz: todavía hoy.
    expect(calendarDaysUntil(new Date("2026-10-10T02:00:00Z"), NOW, TZ)).toBe(0);
    // 05:00 UTC del 10 = 01:00 del 10 en La Paz: mañana.
    expect(calendarDaysUntil(new Date("2026-10-10T05:00:00Z"), NOW, TZ)).toBe(1);
  });

  it("Hoy, Mañana, En N días y nada si falta mucho", () => {
    expect(relativeDay(day(0), NOW, TZ)).toBe("Hoy");
    expect(relativeDay(day(1), NOW, TZ)).toBe("Mañana");
    expect(relativeDay(day(6), NOW, TZ)).toBe("En 6 días");
    expect(relativeDay(day(14), NOW, TZ)).toBe("En 14 días");
    expect(relativeDay(day(15), NOW, TZ)).toBeNull();
    expect(relativeDay(day(-1), NOW, TZ)).toBeNull();
  });

  it("día de la semana y hora en la hora del recinto", () => {
    // 02:00 UTC del 27 de oct = 22:00 del 26 en La Paz (lunes).
    expect(weekdayTime(new Date("2026-10-27T02:00:00Z"), TZ)).toMatch(/^lun\.?,? 22:00$/);
  });

  it("cuánto falta para que termine una oferta y fecha corta", () => {
    expect(endsIn(day(0), NOW, TZ)).toBe("Termina hoy");
    expect(endsIn(day(1), NOW, TZ)).toBe("Termina mañana");
    expect(endsIn(day(5), NOW, TZ)).toBe("Quedan 5 días");
    expect(shortDate(new Date("2026-10-20T23:59:00Z"), TZ)).toBe("20 oct");
  });
});

describe("insignias de un evento", () => {
  it("sin nada especial no lleva insignias", () => {
    expect(salesBadges(base, NOW)).toEqual([]);
  });

  it("descuento de preventa: muestra el porcentaje; sin descuento, 'Preventa'", () => {
    expect(salesBadges({ ...base, discountPercent: 15, discountUntil: day(5) }, NOW)[0]).toEqual({ kind: "discount", text: "-15% preventa" });
    expect(salesBadges({ ...base, presaleUntil: day(5) }, NOW)[0]).toEqual({ kind: "presale", text: "Preventa" });
  });

  it("últimos lugares, se está agotando y agotado", () => {
    expect(salesBadges({ ...base, left: 12 }, NOW)).toEqual([{ kind: "low", text: "¡Últimos 12 lugares!" }]);
    expect(salesBadges({ ...base, left: 1 }, NOW)[0]!.text).toBe("¡Último lugar!");
    expect(salesBadges({ ...base, left: 250 }, NOW)).toEqual([{ kind: "hot", text: "Se está agotando" }]);
    expect(salesBadges({ ...base, left: 0 }, NOW)).toEqual([{ kind: "soldout", text: "Agotado" }]);
    // El descuento no tapa que ya no quedan lugares.
    expect(salesBadges({ ...base, left: 0, discountPercent: 20, discountUntil: day(2) }, NOW)).toEqual([{ kind: "soldout", text: "Agotado" }]);
  });

  it("hoy o mañana se avisa; más adelante no", () => {
    expect(salesBadges({ ...base, startsAt: day(0) }, NOW)).toEqual([{ kind: "soon", text: "Hoy" }]);
    expect(salesBadges({ ...base, startsAt: day(1) }, NOW)).toEqual([{ kind: "soon", text: "Mañana" }]);
    expect(salesBadges({ ...base, startsAt: day(3) }, NOW)).toEqual([]);
  });

  it("sin venta ahora (todavía no empieza) no lleva insignias, salvo agotado", () => {
    expect(salesBadges({ ...base, onSale: false, left: 0, capacity: 0 }, NOW)).toEqual([]);
    expect(salesBadges({ ...base, onSale: false, left: 0, capacity: 100 }, NOW)).toEqual([{ kind: "soldout", text: "Agotado" }]);
  });

  it("la línea de la oferta dice hasta cuándo y cuánto falta", () => {
    expect(offerLine({ ...base, discountPercent: 15, discountUntil: day(5) }, NOW)).toBe("Descuento hasta 14 oct · Quedan 5 días");
    expect(offerLine({ ...base, presaleUntil: day(1) }, NOW)).toBe("Preventa hasta 10 oct · Termina mañana");
    expect(offerLine(base, NOW)).toBeNull();
  });
});

describe("eventos destacados", () => {
  const plain = { ...base, id: "plain", startsAt: day(3) };
  const offer = { ...base, id: "offer", startsAt: day(30), discountPercent: 20, discountUntil: day(10) };
  const urgent = { ...base, id: "urgent", startsAt: day(30), discountPercent: 20, discountUntil: day(2) };
  const low = { ...base, id: "low", startsAt: day(30), left: 10 };
  const sold = { ...base, id: "sold", startsAt: day(2), left: 0 };
  const closed = { ...base, id: "closed", startsAt: day(2), onSale: false };

  it("una oferta vigente pesa más que un evento común aunque este sea más próximo", () => {
    expect(featuredScore(offer, NOW)).toBeGreaterThan(featuredScore(plain, NOW));
  });

  it("una oferta por terminar sube sobre una que tiene tiempo, y lo que se agota sobre lo común", () => {
    expect(featuredScore(urgent, NOW)).toBeGreaterThan(featuredScore(offer, NOW));
    expect(featuredScore(low, NOW)).toBeGreaterThan(featuredScore({ ...plain, startsAt: day(30) }, NOW));
  });

  it("lo agotado o sin venta no se destaca", () => {
    expect(featuredScore(sold, NOW)).toBe(-1);
    expect(featuredScore(closed, NOW)).toBe(-1);
    expect(pickFeatured([sold, closed], NOW)).toEqual([]);
  });

  it("devuelve a lo sumo n, ordenados, y desempata por fecha", () => {
    const a = { ...base, id: "a", startsAt: day(9) };
    const b = { ...base, id: "b", startsAt: day(9, 20) };
    expect(pickFeatured([plain, offer, urgent, low, sold, closed], NOW, 3).map((c) => c.id)).toEqual(["urgent", "offer", "low"]);
    expect(pickFeatured([a, b], NOW).map((c) => c.id)).toEqual(["b", "a"]); // el que pasa antes (16:00) va primero
  });
});
