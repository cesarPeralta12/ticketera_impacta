/**
 * Retenciones: butacas apartadas que la web no vende (salvo con el código de su retención), la boletería sí, no se
 * retiene lo vendido ni dos veces la misma butaca, y al liberar vuelven a la venta.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { getHeldSeatIds, holdSeats, releaseSeatHold, unholdSeats, updateSeatHold } from "../src/operations/holds";
import { buyer, createPendingOrder, createSeatedEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

async function setup() {
  const { session, sections } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 6 }] });
  const staff = await prisma.staffUser.create({ data: { email: `ret-${randomCode(6).toLowerCase()}@prueba.test`, name: "Prod", passwordHash: "!" } });
  const type = sections[0]!.ticketType;
  const seats = sections[0]!.seats;
  const order = (n: number, seatIds: string[], opts: { holdCode?: string; channel?: "POS" } = {}) =>
    createPendingOrder(
      { sessionId: session.id, buyer: buyer(n), items: [{ ticketTypeId: type.id, quantity: seatIds.length, seatIds }] },
      { holdCode: opts.holdCode, ...(opts.channel ? { channel: opts.channel, issuedById: staff.id } : {}) },
    );
  return { session, staff, seats, order };
}

describe("retenciones", () => {
  it("la web no vende lo apartado; con el código, sí; la boletería, siempre", async () => {
    const { session, staff, seats, order } = await setup();
    await holdSeats({ sessionId: session.id, staffId: staff.id, seatIds: [seats[0]!.id, seats[1]!.id], name: "Prensa", color: "#ff0000", code: "prensa 26" });
    await holdSeats({ sessionId: session.id, staffId: staff.id, seatIds: [seats[2]!.id], name: "Artista" });

    await expect(order(1, [seats[0]!.id])).rejects.toMatchObject({ code: "SEAT_TAKEN", message: expect.stringContaining("apartada") });
    // El código de Prensa abre las de Prensa, no las del Artista.
    expect((await order(2, [seats[0]!.id], { holdCode: "PRENSA26" })).status).toBe("PENDING_PAYMENT");
    await expect(order(3, [seats[2]!.id], { holdCode: "PRENSA26" })).rejects.toMatchObject({ code: "SEAT_TAKEN" });
    expect((await order(4, [seats[2]!.id], { channel: "POS" })).status).toBe("PENDING_PAYMENT");

    const held = await getHeldSeatIds(prisma, session.id);
    expect(held.has(seats[1]!.id)).toBe(true);
    expect((await getHeldSeatIds(prisma, session.id, "prensa26")).has(seats[1]!.id)).toBe(false);
  });

  it("no retiene lo vendido ni dos veces la misma butaca; liberar la devuelve a la venta", async () => {
    const { session, staff, seats, order } = await setup();
    await order(5, [seats[5]!.id]);
    await expect(holdSeats({ sessionId: session.id, staffId: staff.id, seatIds: [seats[5]!.id], name: "Prod" })).rejects.toMatchObject({ code: "SEAT_TAKEN" });

    const holdId = await holdSeats({ sessionId: session.id, staffId: staff.id, seatIds: [seats[0]!.id], name: "Prod" });
    await expect(holdSeats({ sessionId: session.id, staffId: staff.id, seatIds: [seats[0]!.id], name: "Otra" })).rejects.toMatchObject({ code: "DUPLICATE" });
    await holdSeats({ sessionId: session.id, staffId: staff.id, seatIds: [seats[1]!.id], holdId });
    await updateSeatHold({ holdId, staffId: staff.id, name: "Producción", color: "#00aa00", code: "PROD" });
    expect(await prisma.seatHold.findUniqueOrThrow({ where: { id: holdId } })).toMatchObject({ name: "Producción", code: "PROD" });

    expect(await unholdSeats({ sessionId: session.id, staffId: staff.id, seatIds: [seats[1]!.id] })).toBe(1);
    expect((await order(6, [seats[1]!.id])).status).toBe("PENDING_PAYMENT");
    expect(await releaseSeatHold({ holdId, staffId: staff.id })).toBe(1);
    expect((await order(7, [seats[0]!.id])).status).toBe("PENDING_PAYMENT");
  });
});
