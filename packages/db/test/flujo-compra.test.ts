/**
 * Pruebas de integración del flujo crítico contra PostgreSQL real:
 * reserva -> pago -> emisión -> acceso, incluidos los casos de concurrencia.
 */
import { afterAll, describe, expect, it } from "vitest";
import { RESERVATION_MINUTES, signTicketPayload } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { applyPaymentUpdate, startPayment } from "../src/operations/payments";
import { DomainError } from "../src/operations/shared";
import { buyer, createPendingOrder, createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

const minutes = (n: number) => n * 60_000;

async function buyAndPay(sessionId: string, ticketTypeId: string, quantity: number) {
  const order = await createPendingOrder({ sessionId, items: [{ ticketTypeId, quantity }], buyer: buyer(0) });
  const payment = await startPayment(order.code, "mock");
  const approve = () =>
    applyPaymentUpdate({
      paymentId: payment.id,
      provider: "mock",
      providerPaymentId: `mock_${payment.id}`,
      status: "APPROVED",
      providerStatus: "approved",
      amount: payment.amount,
      currency: payment.currency,
    });
  return { order, payment, approve };
}

describe("reserva de inventario", () => {
  it("60 compras simultáneas no superan el aforo compartido de la sección", async () => {
    // Cancha de 25 personas, compartida por Preventa (cupo 20) y General (cupo 20).
    const { session, types } = await createGeneralAdmissionEvent({
      sectionCapacity: 25,
      types: [
        { name: "Preventa", capacity: 20 },
        { name: "General", capacity: 20 },
      ],
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 60 }, (_, i) =>
        createPendingOrder({
          sessionId: session.id,
          items: [{ ticketTypeId: types[i % 2]!.id, quantity: 1 }],
          buyer: buyer(i),
        }),
      ),
    );

    const ok = attempts.filter((a) => a.status === "fulfilled");
    const failed = attempts.filter((a): a is PromiseRejectedResult => a.status === "rejected");
    expect(ok).toHaveLength(25);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(DomainError);
      expect((f.reason as DomainError).code).toBe("SOLD_OUT");
    }

    const perType = await prisma.orderItem.groupBy({
      by: ["ticketTypeId"],
      where: { ticketType: { sessionId: session.id } },
      _sum: { quantity: true },
    });
    const total = perType.reduce((sum, row) => sum + (row._sum.quantity ?? 0), 0);
    expect(total).toBe(25);
    for (const row of perType) expect(row._sum.quantity).toBeLessThanOrEqual(20);
  });

  it("una reserva vencida libera el cupo", async () => {
    const { session, types } = await createGeneralAdmissionEvent({
      sectionCapacity: 1,
      types: [{ name: "General", capacity: 1 }],
    });
    const items = [{ ticketTypeId: types[0]!.id, quantity: 1 }];
    const t0 = new Date();

    await createPendingOrder({ sessionId: session.id, items, buyer: buyer(1) }, { now: t0 });
    await expect(
      createPendingOrder({ sessionId: session.id, items, buyer: buyer(2) }, { now: new Date(t0.getTime() + minutes(1)) }),
    ).rejects.toMatchObject({ code: "SOLD_OUT" });

    const later = new Date(t0.getTime() + minutes(RESERVATION_MINUTES + 1));
    await expect(createPendingOrder({ sessionId: session.id, items, buyer: buyer(2) }, { now: later })).resolves.toBeTruthy();
  });
});

describe("pagos", () => {
  it("un webhook duplicado no emite entradas dos veces", async () => {
    const { session, types } = await createGeneralAdmissionEvent({
      sectionCapacity: 100,
      types: [{ name: "General", capacity: 100 }],
    });
    const { order, approve } = await buyAndPay(session.id, types[0]!.id, 3);

    const outcomes = (await Promise.all([approve(), approve(), approve()])).map((r) => r.outcome).sort();
    expect(outcomes).toEqual(["DUPLICATE", "DUPLICATE", "PAID"]);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(3);
  });

  it("rechaza una notificación con monto adulterado", async () => {
    const { session, types } = await createGeneralAdmissionEvent({
      sectionCapacity: 10,
      types: [{ name: "General", capacity: 10, unitAmount: 50_000 }],
    });
    const { order, payment } = await buyAndPay(session.id, types[0]!.id, 1);

    await expect(
      applyPaymentUpdate({
        paymentId: payment.id,
        provider: "mock",
        providerPaymentId: "mock_x",
        status: "APPROVED",
        providerStatus: "approved",
        amount: 1,
        currency: "CLP",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_PAYMENT");
  });

  it("un pago tardío se acepta si todavía hay cupo", async () => {
    const { session, types } = await createGeneralAdmissionEvent({
      sectionCapacity: 5,
      types: [{ name: "General", capacity: 5 }],
    });
    const { order, payment } = await buyAndPay(session.id, types[0]!.id, 1);
    const late = new Date(order.expiresAt.getTime() + minutes(5));

    const { outcome } = await applyPaymentUpdate(
      {
        paymentId: payment.id,
        provider: "mock",
        providerPaymentId: "mock_late",
        status: "APPROVED",
        providerStatus: "approved",
        amount: payment.amount,
        currency: payment.currency,
      },
      late,
    );
    expect(outcome).toBe("PAID");
  });

  it("un pago tardío sin cupo deja la orden expirada y pide reembolso", async () => {
    const { session, types } = await createGeneralAdmissionEvent({
      sectionCapacity: 1,
      types: [{ name: "General", capacity: 1 }],
    });
    const items = [{ ticketTypeId: types[0]!.id, quantity: 1 }];
    const t0 = new Date();

    const first = await createPendingOrder({ sessionId: session.id, items, buyer: buyer(1) }, { now: t0 });
    const payment = await startPayment(first.code, "mock", new Date(t0.getTime() + minutes(1)));
    // La reserva vence y otra persona toma el único cupo.
    const afterExpiry = new Date(t0.getTime() + minutes(RESERVATION_MINUTES + 1));
    const second = await createPendingOrder({ sessionId: session.id, items, buyer: buyer(2) }, { now: afterExpiry });

    const { outcome } = await applyPaymentUpdate(
      {
        paymentId: payment.id,
        provider: "mock",
        providerPaymentId: "mock_tarde",
        status: "APPROVED",
        providerStatus: "approved",
        amount: payment.amount,
        currency: payment.currency,
      },
      new Date(afterExpiry.getTime() + minutes(1)),
    );

    expect(outcome).toBe("REFUND_REQUIRED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("EXPIRED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("PENDING_PAYMENT");
    expect(await prisma.ticket.count({ where: { orderId: first.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { action: "payment.refund_required", entityId: payment.id } }),
    ).toBe(1);
  });
});

describe("control de acceso", () => {
  it("si 10 puertas leen la misma entrada a la vez, solo una la acepta", async () => {
    const { session, types } = await createGeneralAdmissionEvent({
      sectionCapacity: 10,
      types: [{ name: "General", capacity: 10 }],
    });
    const { order, approve } = await buyAndPay(session.id, types[0]!.id, 1);
    await approve();
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
    const qr = await signTicketPayload(ticket.code, process.env.TICKET_QR_SECRET!);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => scanTicket({ sessionId: session.id, raw: qr })),
    );
    const accepted = results.filter((r) => r.result === "ACCEPTED");
    expect(accepted).toHaveLength(1);
    expect(results.filter((r) => r.result === "ALREADY_USED")).toHaveLength(9);
    expect(await prisma.accessScan.count({ where: { ticketId: ticket.id } })).toBe(10);
  });

  it("rechaza QR falsificados y entradas de otra función", async () => {
    const a = await createGeneralAdmissionEvent({ sectionCapacity: 5, types: [{ name: "General", capacity: 5 }] });
    const b = await createGeneralAdmissionEvent({ sectionCapacity: 5, types: [{ name: "General", capacity: 5 }] });
    const { order, approve } = await buyAndPay(a.session.id, a.types[0]!.id, 1);
    await approve();
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });

    const forged = await signTicketPayload(ticket.code, "secreto-falso");
    expect((await scanTicket({ sessionId: a.session.id, raw: forged })).result).toBe("INVALID");
    expect((await scanTicket({ sessionId: b.session.id, raw: ticket.code })).result).toBe("WRONG_SESSION");
    expect((await scanTicket({ sessionId: a.session.id, raw: "ZZZZZ-ZZZZZ" })).result).toBe("NOT_FOUND");
    expect((await scanTicket({ sessionId: a.session.id, raw: ticket.code })).result).toBe("ACCEPTED");
  });
});
