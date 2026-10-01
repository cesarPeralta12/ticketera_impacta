import { describe, expect, it } from "vitest";
import { checkoutSchema, orderTotals } from "./checkout";

const valid = {
  sessionId: "s1",
  items: [{ ticketTypeId: "t1", quantity: 2 }],
  buyer: { name: "Ana Pérez", email: " Ana@Correo.CL ", document: "" },
};

describe("checkout", () => {
  it("normaliza los datos del comprador", () => {
    const parsed = checkoutSchema.parse(valid);
    expect(parsed.buyer.email).toBe("ana@correo.cl");
    expect(parsed.buyer.document).toBeUndefined();
  });

  it("exige al menos una entrada y respeta el máximo por compra", () => {
    expect(checkoutSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
    expect(
      checkoutSchema.safeParse({
        ...valid,
        items: [
          { ticketTypeId: "t1", quantity: 6 },
          { ticketTypeId: "t2", quantity: 5 },
        ],
      }).success,
    ).toBe(false);
  });

  it("las butacas elegidas deben coincidir con la cantidad y no repetirse", () => {
    const seated = (seatIds: string[], quantity: number) =>
      checkoutSchema.safeParse({ ...valid, items: [{ ticketTypeId: "t1", quantity, seatIds }] }).success;
    expect(seated(["s1", "s2"], 2)).toBe(true);
    expect(seated(["s1", "s2"], 3)).toBe(false);
    expect(seated(["s1", "s1"], 2)).toBe(false);
  });

  it("rechaza emails inválidos", () => {
    expect(
      checkoutSchema.safeParse({ ...valid, buyer: { ...valid.buyer, email: "no-es-email" } }).success,
    ).toBe(false);
  });

  it("calcula totales en enteros", () => {
    expect(
      orderTotals([
        { unitAmount: 30000, quantity: 2 },
        { unitAmount: 80000, quantity: 1 },
      ]),
    ).toEqual({ subtotalAmount: 140000, feeAmount: 0, totalAmount: 140000 });
  });
});
