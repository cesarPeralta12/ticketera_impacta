/**
 * Descuento de preventa: el servidor cobra el precio con descuento mientras dura la ventana
 * y el precio normal después, sobre el mismo tipo de entrada.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { createPendingOrder } from "../src/operations/orders";
import { buyer, createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

async function eventWithDiscount(discount: { percent: number; starts?: Date; ends: Date }) {
  const { session, types } = await createGeneralAdmissionEvent({
    sectionCapacity: 50,
    types: [{ name: "General", capacity: 50, unitAmount: 10_000 }],
  });
  await prisma.ticketType.update({
    where: { id: types[0]!.id },
    data: { discountPercent: discount.percent, discountStartsAt: discount.starts ?? null, discountEndsAt: discount.ends },
  });
  return { session, type: types[0]! };
}

describe("descuento de preventa", () => {
  it("cobra con descuento durante la ventana y guarda ese precio en la orden", async () => {
    const { session, type } = await eventWithDiscount({ percent: 20, ends: hours(24) });
    const order = await createPendingOrder({ sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 3 }], buyer: buyer(1) });
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(saved.items[0]!.unitAmount).toBe(8_000);
    expect(saved.totalAmount).toBe(24_000);
  });

  it("cuando la preventa terminó, cobra el precio normal", async () => {
    const { session, type } = await eventWithDiscount({ percent: 20, starts: hours(-48), ends: hours(-1) });
    const order = await createPendingOrder({ sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 1 }], buyer: buyer(2) });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalAmount).toBe(10_000);
  });

  it("antes de que empiece el descuento tampoco se aplica", async () => {
    const { session, type } = await eventWithDiscount({ percent: 50, starts: hours(5), ends: hours(30) });
    const order = await createPendingOrder({ sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 2 }], buyer: buyer(3) });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalAmount).toBe(20_000);
  });
});
