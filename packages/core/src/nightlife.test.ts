import { describe, expect, it } from "vitest";
import { findShortage, remainingByType, sellableCapacity, type InventoryLine } from "./inventory";
import { utcToZonedInput, zonedDateTimeToUtc } from "./locale";
import { consumptionLeft, entryDeadline, localWeekday, peopleIn, tableLabel, weeklyNights } from "./nightlife";

const TZ = "America/La_Paz";
const at = (local: string) => zonedDateTimeToUtc(local, TZ);
const local = (date: Date) => utcToZonedInput(date, TZ);

describe("hora límite de ingreso", () => {
  it("free hasta la 01:00 en una noche de las 23:00 vence al día siguiente", () => {
    expect(local(entryDeadline(at("2026-10-16T23:00"), "01:00", TZ))).toBe("2026-10-17T01:00");
  });

  it("una hora posterior al inicio, el mismo día", () => {
    expect(local(entryDeadline(at("2026-10-16T22:00"), "23:30", TZ))).toBe("2026-10-16T23:30");
  });

  it("la misma hora del inicio cuenta como el día siguiente", () => {
    expect(local(entryDeadline(at("2026-10-16T23:00"), "23:00", TZ))).toBe("2026-10-17T23:00");
  });

  it("rechaza una hora mal escrita", () => {
    expect(() => entryDeadline(at("2026-10-16T23:00"), "25:00", TZ)).toThrow();
  });
});

describe("noches que se repiten", () => {
  const friday = at("2026-10-16T23:00"); // viernes

  it("viernes y sábados de 4 semanas: 8 noches a la misma hora, sin la noche modelo", () => {
    const nights = weeklyNights({ template: friday, weekdays: [5, 6], weeks: 4, timeZone: TZ }).map(local);
    expect(nights).toEqual([
      "2026-10-17T23:00",
      "2026-10-23T23:00",
      "2026-10-24T23:00",
      "2026-10-30T23:00",
      "2026-10-31T23:00",
      "2026-11-06T23:00",
      "2026-11-07T23:00",
      "2026-11-13T23:00",
    ]);
  });

  it("todas caen en el día elegido (cruzando de mes)", () => {
    const nights = weeklyNights({ template: friday, weekdays: [4], weeks: 6, timeZone: TZ });
    expect(nights).toHaveLength(6);
    expect(nights.every((n) => localWeekday(n, TZ) === 4)).toBe(true);
  });

  it("sin días o sin semanas no crea nada, y no pasa del máximo", () => {
    expect(weeklyNights({ template: friday, weekdays: [], weeks: 4, timeZone: TZ })).toEqual([]);
    expect(weeklyNights({ template: friday, weekdays: [5], weeks: 0, timeZone: TZ })).toEqual([]);
    expect(weeklyNights({ template: friday, weekdays: [5], weeks: 500, timeZone: TZ })).toHaveLength(26);
  });
});

describe("mesas y consumo", () => {
  it("una mesa de 6 son 6 personas; una entrada, 1", () => {
    expect(peopleIn({ kind: "TABLE", peoplePerUnit: 6 })).toBe(6);
    expect(peopleIn({ kind: "ENTRY", peoplePerUnit: 6 })).toBe(1);
  });

  it("el saldo nunca es negativo", () => {
    expect(consumptionLeft({ amount: 100_000, spent: 25_000 })).toBe(75_000);
    expect(consumptionLeft({ amount: 100, spent: 150 })).toBe(0);
  });

  // Zona VIP para 40 personas: entradas VIP sueltas y mesas de 6 comparten el aforo.
  const vip = (entries: number, tables: number): InventoryLine[] => [
    { ticketTypeId: "vip", name: "VIP", capacity: 40, used: entries, sectionId: "zona", sectionCapacity: 40 },
    { ticketTypeId: "mesa", name: "Mesa VIP", capacity: 5, used: tables, sectionId: "zona", sectionCapacity: 40, peoplePerUnit: 6 },
  ];

  it("cada mesa ocupa en la zona los lugares de todas sus personas", () => {
    const remaining = remainingByType(vip(10, 3)); // 10 + 3×6 = 28 ocupados, quedan 12
    expect(remaining.get("vip")).toBe(12);
    expect(remaining.get("mesa")).toBe(2); // caben 2 mesas de 6 (y el cupo es de 5)
  });

  it("no vende una mesa si no caben sus personas", () => {
    expect(findShortage(vip(30, 1), [{ ticketTypeId: "mesa", quantity: 1 }])).toEqual({
      ticketTypeId: "mesa",
      name: "Mesa VIP",
      available: 0,
    }); // 30 + 6 = 36 ocupados: quedan 4 lugares, no alcanza para 6
    expect(findShortage(vip(28, 1), [{ ticketTypeId: "mesa", quantity: 1 }])).toBeNull(); // 34 + 6 = 40
  });

  it("el aforo vendible de mesas se cuenta en personas", () => {
    expect(sellableCapacity([{ capacity: 10, sectionId: null, section: null, peoplePerUnit: 6 }])).toBe(60);
  });
});

describe("mesas elegidas en el mapa", () => {
  it("se llaman por su lugar en el mapa", () => {
    expect(tableLabel("VIP", null, "A-3")).toBe("VIP · Mesa A-3");
    expect(tableLabel("Mesa VIP", 4)).toBe("Mesa VIP N° 4");
    expect(tableLabel("General", null)).toBeNull();
  });

  it("el aforo de una sección numerada de mesas se cuenta en personas", () => {
    // 24 mesas de 2 en una sección numerada: 48 personas.
    expect(sellableCapacity([{ capacity: 24, sectionId: "lounge", section: { capacity: 24, seatingMode: "RESERVED" }, peoplePerUnit: 2 }])).toBe(48);
  });
});
