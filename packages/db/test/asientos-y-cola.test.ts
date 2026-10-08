/**
 * Butacas numeradas y cola virtual contra PostgreSQL real.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { applyPaymentUpdate, startPayment } from "../src/operations/payments";
import { getQueueStatus, joinQueue } from "../src/operations/queue";
import { buyer, createPendingOrder, createSeatedEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

const seatOrder = (sessionId: string, ticketTypeId: string, seatIds: string[], n = 0, queueToken?: string) =>
  createPendingOrder(
    { sessionId, items: [{ ticketTypeId, quantity: seatIds.length, seatIds }], buyer: buyer(n) },
    { queueToken },
  );

describe("butacas numeradas", () => {
  it("si 20 personas eligen la misma butaca a la vez, solo una la obtiene", async () => {
    const { session, sections } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 10 }] });
    const [platea] = sections;
    const seat = platea!.seats[0]!.id;

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => seatOrder(session.id, platea!.ticketType.id, [seat], i)),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    for (const a of attempts.filter((a): a is PromiseRejectedResult => a.status === "rejected")) {
      expect(a.reason).toMatchObject({ code: "SEAT_TAKEN" });
    }
  });

  it("butacas distintas de la misma sección se venden sin problema", async () => {
    const { session, sections } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 10 }] });
    const [platea] = sections;
    const results = await Promise.allSettled(
      platea!.seats.map((s, i) => seatOrder(session.id, platea!.ticketType.id, [s.id], i)),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("rechaza una butaca que no es de la sección del tipo de entrada", async () => {
    const { session, sections } = await createSeatedEvent({
      sections: [
        { name: "Platea", seats: 2 },
        { name: "Palco", seats: 2 },
      ],
    });
    const [platea, palco] = sections;
    await expect(seatOrder(session.id, platea!.ticketType.id, [palco!.seats[0]!.id])).rejects.toMatchObject({
      code: "INVALID_ITEMS",
    });
  });

  it("al pagar, cada entrada queda asociada a su butaca", async () => {
    const { session, sections } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 5 }] });
    const [platea] = sections;
    const seatIds = platea!.seats.slice(0, 2).map((s) => s.id);
    const order = await seatOrder(session.id, platea!.ticketType.id, seatIds);
    const payment = await startPayment(order.code, "mock");
    await applyPaymentUpdate({
      paymentId: payment.id,
      provider: "mock",
      providerPaymentId: "mock_butacas",
      status: "APPROVED",
      providerStatus: "approved",
      amount: payment.amount,
      currency: payment.currency,
    });
    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets.map((t) => t.seatId).sort()).toEqual([...seatIds].sort());
    expect(order.totalAmount).toBe(18_000);
  });
});

describe("cola virtual", () => {
  it("sin turno vigente no se puede comprar, aunque se llame a la acción directamente", async () => {
    const { session, sections } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 5 }], queue: 1 });
    const [platea] = sections;
    await expect(seatOrder(session.id, platea!.ticketType.id, [platea!.seats[0]!.id])).rejects.toMatchObject({
      code: "QUEUE_REQUIRED",
    });
    await expect(
      seatOrder(session.id, platea!.ticketType.id, [platea!.seats[0]!.id], 0, "token-inventado"),
    ).rejects.toMatchObject({ code: "QUEUE_REQUIRED" });
  });

  it("nunca admite más compradores que el cupo, aunque pregunten todos a la vez", async () => {
    // Varias rondas: la sobreadmisión es una carrera estrecha y una sola ronda puede no mostrarla.
    for (let round = 0; round < 6; round++) {
      const { session } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 5 }], queue: 5 });
      const tokens = Array.from({ length: 60 }, () => randomUUID());
      await prisma.queueEntry.createMany({ data: tokens.map((token) => ({ sessionId: session.id, token })) });

      const statuses = await Promise.all(tokens.map((t) => getQueueStatus(session.id, t)));
      const admitted = await prisma.queueEntry.count({ where: { sessionId: session.id, admittedAt: { not: null } } });
      expect(admitted).toBe(5);
      expect(statuses.filter((s) => s.state === "admitted")).toHaveLength(5);
      const positions = statuses.flatMap((s) => (s.state === "waiting" ? [s.position] : [])).sort((a, b) => a - b);
      expect(positions).toEqual(Array.from({ length: 55 }, (_, i) => i + 1));
    }
  });

  it("al comprar, el turno se libera y pasa el siguiente en orden de llegada", async () => {
    const { session, sections } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 5 }], queue: 1 });
    const [platea] = sections;
    const [first, second] = [randomUUID(), randomUUID()];
    await joinQueue(session.id, first);
    await joinQueue(session.id, second);

    expect((await getQueueStatus(session.id, first)).state).toBe("admitted");
    expect(await getQueueStatus(session.id, second)).toMatchObject({ state: "waiting", position: 1 });

    await seatOrder(session.id, platea!.ticketType.id, [platea!.seats[0]!.id], 1, first);

    expect((await getQueueStatus(session.id, first)).state).toBe("finished");
    expect((await getQueueStatus(session.id, second)).state).toBe("admitted");
  });
});
