import { describe, expect, it } from "vitest";
import { findShortage, remainingByType, sellableCapacity, type InventoryLine } from "./inventory";

// Cancha con aforo 2.000 compartido entre Preventa (cupo 500) y General (cupo 1.800).
const festival = (preventaUsed: number, generalUsed: number): InventoryLine[] => [
  { ticketTypeId: "pre", name: "Preventa", capacity: 500, used: preventaUsed, sectionId: "cancha", sectionCapacity: 2000 },
  { ticketTypeId: "gen", name: "General", capacity: 1800, used: generalUsed, sectionId: "cancha", sectionCapacity: 2000 },
  { ticketTypeId: "vip", name: "VIP", capacity: 300, used: 0, sectionId: null, sectionCapacity: null },
];

describe("inventario", () => {
  it("el disponible es el menor entre el cupo del tipo y el aforo de la sección", () => {
    const remaining = remainingByType(festival(400, 1500));
    expect(remaining.get("pre")).toBe(100); // le quedan 100 de su cupo y caben 100 en la Cancha
    expect(remaining.get("gen")).toBe(100); // tiene 300 de cupo, pero la Cancha solo admite 100 más
    expect(remaining.get("vip")).toBe(300);
  });

  it("acepta un pedido que cabe", () => {
    expect(findShortage(festival(0, 0), [{ ticketTypeId: "pre", quantity: 4 }])).toBeNull();
  });

  it("rechaza si se supera el cupo del tipo", () => {
    expect(findShortage(festival(498, 0), [{ ticketTypeId: "pre", quantity: 3 }])).toEqual({
      ticketTypeId: "pre",
      name: "Preventa",
      available: 2,
    });
  });

  it("rechaza si dos tipos juntos superan el aforo compartido de la sección", () => {
    const shortage = findShortage(festival(400, 1595), [
      { ticketTypeId: "pre", quantity: 3 },
      { ticketTypeId: "gen", quantity: 3 },
    ]);
    expect(shortage).not.toBeNull();
  });

  it("suma las líneas repetidas de un mismo tipo (una por butaca)", () => {
    const lines: InventoryLine[] = [
      { ticketTypeId: "pla", name: "Platea", capacity: 3, used: 1, sectionId: "s", sectionCapacity: 3 },
    ];
    const oneSeat = { ticketTypeId: "pla", quantity: 1 };
    expect(findShortage(lines, [oneSeat, oneSeat])).toBeNull();
    expect(findShortage(lines, [oneSeat, oneSeat, oneSeat])?.available).toBe(2);
  });

  it("el aforo vendible respeta las secciones compartidas", () => {
    const campo = { capacity: 800 };
    expect(
      sellableCapacity([
        { capacity: 300, sectionId: "campo", section: campo },
        { capacity: 800, sectionId: "campo", section: campo },
        { capacity: 40, sectionId: "palco", section: { capacity: 40 } },
        { capacity: 10, sectionId: null, section: null },
      ]),
    ).toBe(850);
  });

  it("rechaza tipos de entrada desconocidos", () => {
    expect(findShortage(festival(0, 0), [{ ticketTypeId: "x", quantity: 1 }])?.available).toBe(0);
  });
});
