import { describe, expect, it } from "vitest";
import {
  InvalidTransitionError,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  TICKET_TRANSITIONS,
  assertTransition,
  canTransition,
} from "./status";

describe("máquinas de estado", () => {
  it("una orden pendiente puede pagarse, expirar o cancelarse", () => {
    expect(canTransition(ORDER_TRANSITIONS, "PENDING_PAYMENT", "PAID")).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, "PENDING_PAYMENT", "EXPIRED")).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, "PENDING_PAYMENT", "REFUNDED")).toBe(false);
  });

  it("permite el pago tardío de una orden expirada", () => {
    expect(canTransition(ORDER_TRANSITIONS, "EXPIRED", "PAID")).toBe(true);
  });

  it("los estados finales no tienen salida", () => {
    for (const map of [ORDER_TRANSITIONS, PAYMENT_TRANSITIONS, TICKET_TRANSITIONS]) {
      for (const [from, targets] of Object.entries(map)) {
        if (["CANCELLED", "REFUNDED", "REJECTED", "CHARGED_BACK", "USED"].includes(from)) {
          expect(targets).toEqual([]);
        }
      }
    }
  });

  it("una entrada usada no vuelve a ser válida (evita doble ingreso)", () => {
    expect(() => assertTransition("ticket", TICKET_TRANSITIONS, "USED", "VALID")).toThrow(
      InvalidTransitionError,
    );
  });
});
