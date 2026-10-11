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

describe("cola virtual: fantasmas y latidos", () => {
  const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

  it("quien dejó de preguntar no bloquea el primer lugar ni se lleva el turno", async () => {
    const { session } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 5 }], queue: 1 });
    const [ghostA, ghostB, live] = [randomUUID(), randomUUID(), randomUUID()];
    await joinQueue(session.id, ghostA);
    await joinQueue(session.id, ghostB);
    await joinQueue(session.id, live);
    // Los dos primeros cerraron la pestaña hace 5 minutos.
    await prisma.queueEntry.updateMany({ where: { sessionId: session.id, token: { in: [ghostA, ghostB] } }, data: { lastSeenAt: ago(300) } });

    expect((await getQueueStatus(session.id, live)).state).toBe("admitted");
    // Si el fantasma vuelve, conserva su lugar y ve la fila real (el admitido ya no cuenta como esperando).
    expect(await getQueueStatus(session.id, ghostA)).toMatchObject({ state: "waiting", position: 1 });
  });

  it("quien volvió a tiempo conserva su posición original", async () => {
    const { session } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 5 }], queue: 1 });
    const [first, second, third] = [randomUUID(), randomUUID(), randomUUID()];
    await joinQueue(session.id, first);
    await joinQueue(session.id, second);
    await joinQueue(session.id, third);
    expect((await getQueueStatus(session.id, first)).state).toBe("admitted");
    await prisma.queueEntry.updateMany({ where: { sessionId: session.id, token: second }, data: { lastSeenAt: ago(60) } });
    expect(await getQueueStatus(session.id, third)).toMatchObject({ state: "waiting", position: 1 }); // el segundo está ausente
    expect(await getQueueStatus(session.id, second)).toMatchObject({ state: "waiting", position: 1 }); // y al volver recupera su lugar
    expect(await getQueueStatus(session.id, third)).toMatchObject({ state: "waiting", position: 2 });
  });

  it("un admitido que se fue pierde el turno a los 2 minutos y pasa el siguiente", async () => {
    const { session } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 5 }], queue: 1 });
    const [gone, next] = [randomUUID(), randomUUID()];
    await joinQueue(session.id, gone);
    await joinQueue(session.id, next);
    expect((await getQueueStatus(session.id, gone)).state).toBe("admitted");
    expect(await getQueueStatus(session.id, next)).toMatchObject({ state: "waiting" });

    await prisma.queueEntry.updateMany({ where: { sessionId: session.id, token: gone }, data: { lastSeenAt: ago(180) } });
    expect((await getQueueStatus(session.id, next)).state).toBe("admitted");
    // Al volver, no se cuela: tiene que entrar de nuevo a la fila.
    expect((await getQueueStatus(session.id, gone)).state).toBe("finished");
  });

  it("una persona ocupa un solo lugar aunque entre desde otro navegador", async () => {
    const { session } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 5 }], queue: 1 });
    const customer = await prisma.customer.create({ data: { email: `cola-${randomUUID()}@prueba.test`, name: "Ana", passwordHash: "!" } });
    const [phone, laptop, other] = [randomUUID(), randomUUID(), randomUUID()];
    await joinQueue(session.id, phone, new Date(), customer.id);
    await joinQueue(session.id, other);
    await joinQueue(session.id, laptop, new Date(), customer.id); // misma persona, otro navegador

    expect(await prisma.queueEntry.count({ where: { sessionId: session.id, customerId: customer.id } })).toBe(1);
    // El lugar (el primero) pasó al navegador nuevo; el viejo ya no tiene lugar.
    expect((await getQueueStatus(session.id, laptop)).state).toBe("admitted");
    expect((await getQueueStatus(session.id, phone)).state).toBe("not_joined");
  });

  it("no se puede comprar con un turno abandonado, aunque no haya vencido", async () => {
    const { session, sections } = await createSeatedEvent({ sections: [{ name: "Platea", seats: 5 }], queue: 1 });
    const [platea] = sections;
    const token = randomUUID();
    await joinQueue(session.id, token);
    expect((await getQueueStatus(session.id, token)).state).toBe("admitted");
    await prisma.queueEntry.updateMany({ where: { sessionId: session.id, token }, data: { lastSeenAt: ago(180) } });
    await expect(seatOrder(session.id, platea!.ticketType.id, [platea!.seats[0]!.id], 1, token)).rejects.toMatchObject({
      code: "QUEUE_REQUIRED",
    });
  });
});
