/**
 * Transferencia de entradas entre cuentas, contra PostgreSQL real: la entrada cambia de
 * dueño y de QR, el QR viejo ya no entra y la puerta lo reconoce como transferido.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { getSessionSyncData, scanTicket } from "../src/operations/access";
import { createPendingOrder } from "../src/operations/orders";
import { applyPaymentUpdate, startPayment } from "../src/operations/payments";
import { issueGuestTickets } from "../src/operations/sales";
import { transferTicket } from "../src/operations/transfers";
import { buyer, createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

async function customer(name: string) {
  return prisma.customer.create({
    data: { name, email: `${name.toLowerCase()}-${randomCode(6).toLowerCase()}@prueba.test`, passwordHash: "!" },
  });
}

/** Compra pagada con la cuenta de `owner`: devuelve sus entradas. */
async function boughtTickets(owner: { id: string }, quantity = 1) {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
  const order = await createPendingOrder(
    { sessionId: session.id, items: [{ ticketTypeId: types[0]!.id, quantity }], buyer: buyer(1) },
    { customerId: owner.id },
  );
  const payment = await startPayment(order.code, "mock");
  await applyPaymentUpdate({
    paymentId: payment.id,
    provider: "mock",
    providerPaymentId: `mock_${payment.id}`,
    status: "APPROVED",
    providerStatus: "approved",
    amount: payment.amount,
    currency: payment.currency,
  });
  const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
  return { session, types, order, tickets };
}

describe("transferencia de entradas", () => {
  it("la entrada pasa a la otra cuenta con QR nuevo; el viejo sale como transferido en puerta", async () => {
    const [ana, luis] = [await customer("Ana"), await customer("Luis")];
    const { session, tickets } = await boughtTickets(ana);
    const original = tickets[0]!;

    const { ticket } = await transferTicket({ ticketId: original.id, fromCustomerId: ana.id, toEmail: ` ${luis.email.toUpperCase()} ` });
    expect(ticket.customerId).toBe(luis.id);
    expect(ticket.holderName).toBe("Luis");
    expect(ticket.code).not.toBe(original.code);

    const old = await scanTicket({ sessionId: session.id, raw: original.code });
    expect(old.result).toBe("TRANSFERRED");
    expect(old.ticket).toBeNull(); // no muestra a quién se la pasaron
    expect((await scanTicket({ sessionId: session.id, raw: ticket.code })).result).toBe("ACCEPTED");

    // La lista sin conexión de la puerta también sabe que el código viejo no vale.
    const sync = await getSessionSyncData(session.id);
    expect(sync!.transferredCodes).toContain(original.code);
    expect(sync!.tickets.map((t) => t.code)).toContain(ticket.code);
  });

  it("quien la recibe puede volver a transferirla; la cuenta anterior ya no", async () => {
    const [ana, luis, marta] = [await customer("Ana"), await customer("Luis"), await customer("Marta")];
    const { tickets } = await boughtTickets(ana);
    await transferTicket({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, toEmail: luis.email });

    await expect(transferTicket({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, toEmail: marta.email })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const { ticket } = await transferTicket({ ticketId: tickets[0]!.id, fromCustomerId: luis.id, toEmail: marta.email });
    expect(ticket.customerId).toBe(marta.id);
    expect(await prisma.ticketTransfer.count({ where: { ticketId: tickets[0]!.id } })).toBe(2);
  });

  it("solo a cuentas registradas, no a uno mismo, ni entradas usadas, invitaciones o funciones que ya empezaron", async () => {
    const ana = await customer("Ana");
    const luis = await customer("Luis");
    const { session, tickets } = await boughtTickets(ana, 2);
    const [first, second] = tickets as [(typeof tickets)[0], (typeof tickets)[0]];

    await expect(transferTicket({ ticketId: first.id, fromCustomerId: ana.id, toEmail: "nadie@prueba.test" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(transferTicket({ ticketId: first.id, fromCustomerId: ana.id, toEmail: ana.email })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });

    await scanTicket({ sessionId: session.id, raw: first.code });
    await expect(transferTicket({ ticketId: first.id, fromCustomerId: ana.id, toEmail: luis.email })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });

    await expect(
      transferTicket({ ticketId: second.id, fromCustomerId: ana.id, toEmail: luis.email, now: new Date(session.startsAt.getTime() + 1) }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    // Una invitación (nominal) no se transfiere.
    const staff = await prisma.staffUser.create({
      data: { email: `staff-${randomCode(6).toLowerCase()}@prueba.test`, name: "Staff", passwordHash: "!" },
    });
    const { types } = await createGeneralAdmissionEvent({ sectionCapacity: 5, types: [{ name: "Invitado", capacity: 5 }] });
    await issueGuestTickets({ ticketTypeId: types[0]!.id, guests: [{ name: "Ana" }], staffId: staff.id });
    const guestTicket = await prisma.ticket.findFirstOrThrow({ where: { ticketTypeId: types[0]!.id } });
    await prisma.ticket.update({ where: { id: guestTicket.id }, data: { customerId: ana.id } });
    await expect(transferTicket({ ticketId: guestTicket.id, fromCustomerId: ana.id, toEmail: luis.email })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });
});
