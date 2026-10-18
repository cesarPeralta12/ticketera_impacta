import { describe, expect, it } from "vitest";
import { TICKET_MODELS, suggestedPresaleEnd } from "./ticket-models";

describe("modelos de tipo de entrada", () => {
  it("hay uno por cada caso de la planilla", () => {
    expect(TICKET_MODELS.map((m) => m.label)).toEqual(["General", "VIP", "Mesa", "Free", "Preventa"]);
    expect(TICKET_MODELS.find((m) => m.key === "free")).toMatchObject({ price: "0", maxPerOrder: 1 });
  });

  it("la preventa sugiere terminar una semana antes", () => {
    const startsAt = new Date("2026-11-21T00:00:00Z"); // 20/11 20:00 en La Paz
    expect(suggestedPresaleEnd("2026-11-20", new Date("2026-10-17T12:00:00Z"), startsAt)).toBe("2026-11-13T23:59");
    expect(suggestedPresaleEnd("2026-11-20", new Date("2026-11-18T12:00:00Z"), startsAt)).toBeNull();
  });
});
