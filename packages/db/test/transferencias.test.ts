/**
 * Transferencia de entradas: la oferta, la aceptación (código nuevo), los límites y la puerta.
 */
import { afterAll, describe, expect, it } from "vitest";
import { MAX_TRANSFERS_PER_TICKET, MAX_TRANSFER_REQUESTS_PER_HOUR, randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { getDoorDownload } from "../src/operations/mobile";
import { createPendingOrder } from "../src/operations/orders";
import { applyPaymentUpdate, startPayment } from "../src/operations/payments";
import { acceptTransfer, cancelTransfer, createTransfer, declineTransfer, listCustomerTickets, listTransfers } from "../src/operations/transfers";
import { createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

const unique = () => randomCode(6).toLowerCase();
const doc = () => String(1_000_000 + Math.floor(Math.random() * 8_999_999));

async function person(name: string) {
  return prisma.customer.create({
    data: { email: `${name.toLowerCase()}-${unique()}@prueba.test`, name, passwordHash: "!", documentId: doc(), emailVerified: true },
  });
}

/** Una compra pagada de `quantity` entradas de una persona. Devuelve sus entradas. */
async function purchase(owner: { id: string }, quantity = 1, startsInDays = 30) {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 20, types: [{ name: "General", capacity: 20 }] });
  await prisma.eventSession.update({ where: { id: session.id }, data: { startsAt: new Date(Date.now() + startsInDays * 86_400_000) } });
  const order = await createPendingOrder(
    { sessionId: session.id, items: [{ ticketTypeId: types[0]!.id, quantity }], buyer: { name: "Dueña Original", email: "x@prueba.test", document: "1234567" } },
    { customerId: owner.id },
  );
  const payment = await startPayment(order.code, "directo");
  await applyPaymentUpdate({
    paymentId: payment.id,
    provider: "directo",
    providerPaymentId: `directo_${payment.id}`,
    status: "APPROVED",
    providerStatus: "pase_directo",
    amount: payment.amount,
    currency: payment.currency,
  });
  const tickets = await prisma.ticket.findMany({ where: { orderId: order.id }, orderBy: { issuedAt: "asc" } });
  return { session, tickets };
}

describe("ofrecer una entrada", () => {
  it("la oferta queda pendiente y la entrada sigue siendo de quien la ofreció", async () => {
    const ana = await person("Ana");
    const luis = await person("Luis");
    const { tickets } = await purchase(ana, 2);
    const offer = await createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: luis.email.toUpperCase() } });

    expect(offer.transfer.status).toBe("PENDING");
    expect(offer.to).toMatchObject({ email: luis.email, name: "Luis" });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0]!.id } })).customerId).toBe(ana.id);
    expect((await listTransfers(luis.id)).incoming).toHaveLength(1);
    expect((await listTransfers(ana.id)).outgoing).toHaveLength(1);
  });

  it("también se ofrece por carnet, y no se puede a uno mismo, a quien no existe ni sin confirmar", async () => {
    const ana = await person("Ana");
    const luis = await person("Luis");
    const { tickets } = await purchase(ana, 4);
    await expect(createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: ana.email } })).rejects.toMatchObject({ code: "TRANSFER_NOT_ALLOWED" });
    await expect(createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: "nadie@prueba.test" } })).rejects.toMatchObject({ code: "RECIPIENT_NOT_FOUND" });
    await expect(createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: {} })).rejects.toMatchObject({ code: "RECIPIENT_NOT_FOUND" });

    const unverified = await prisma.customer.create({ data: { email: `u-${unique()}@prueba.test`, name: "Sin confirmar", passwordHash: "!", documentId: doc() } });
    await expect(createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: unverified.email } })).rejects.toMatchObject({ code: "RECIPIENT_NOT_FOUND" });

    const byDocument = await createTransfer({ ticketId: tickets[1]!.id, fromCustomerId: ana.id, to: { document: ` ${luis.documentId!.slice(0, 3)}.${luis.documentId!.slice(3)} ` } });
    expect(byDocument.to.email).toBe(luis.email);
  });

  it("solo el dueño la ofrece, una sola oferta a la vez, y no si ya se usó", async () => {
    const ana = await person("Ana");
    const luis = await person("Luis");
    const marta = await person("Marta");
    const { session, tickets } = await purchase(ana, 2);
    await expect(createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: luis.id, to: { email: marta.email } })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: luis.email } });
    await expect(createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: marta.email } })).rejects.toMatchObject({ code: "TRANSFER_NOT_ALLOWED" });

    const used = await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[1]!.id } });
    await scanTicket({ sessionId: session.id, raw: used.code, method: "MANUAL" });
    await expect(createTransfer({ ticketId: used.id, fromCustomerId: ana.id, to: { email: marta.email } })).rejects.toMatchObject({ code: "TRANSFER_NOT_ALLOWED" });
  });

  it("respeta el interruptor del evento y el cierre de las últimas horas", async () => {
    const ana = await person("Ana");
    const luis = await person("Luis");
    const { session, tickets } = await purchase(ana, 1);
    const event = await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id } });

    await prisma.event.update({ where: { id: event.eventId }, data: { transfersEnabled: false } });
    await expect(createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: luis.email } })).rejects.toMatchObject({ message: expect.stringMatching(/no permite/) });
    await prisma.event.update({ where: { id: event.eventId }, data: { transfersEnabled: true } });

    await prisma.eventSession.update({ where: { id: session.id }, data: { startsAt: new Date(Date.now() + 60 * 60_000) } });
    await expect(createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: luis.email } })).rejects.toMatchObject({ message: expect.stringMatching(/menos de/) });
  });

  it("limita los pedidos por hora para que no sirva para buscar cuentas ajenas", async () => {
    const ana = await person("Ana");
    const { tickets } = await purchase(ana, 1);
    let blocked = false;
    for (let i = 0; i < MAX_TRANSFER_REQUESTS_PER_HOUR + 2; i++) {
      try {
        await createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: `nadie-${i}@prueba.test` } });
      } catch (error) {
        if ((error as { code?: string }).code === "TRANSFER_NOT_ALLOWED") blocked = true;
      }
    }
    expect(blocked).toBe(true);
  });
});

describe("aceptar la transferencia", () => {
  it("la entrada cambia de dueña, de titular y de código: el anterior deja de valer", async () => {
    const ana = await person("Ana");
    const luis = await person("Luis");
    const { session, tickets } = await purchase(ana, 1);
    const ticket = tickets[0]!;
    const offer = await createTransfer({ ticketId: ticket.id, fromCustomerId: ana.id, to: { email: luis.email } });

    const result = await acceptTransfer(offer.transfer.id, luis.id);
    expect(result.oldCode).toBe(ticket.code);
    expect(result.newCode).not.toBe(ticket.code);

    const saved = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(saved).toMatchObject({ code: result.newCode, customerId: luis.id, holderName: "Luis", holderDocument: luis.documentId, transferCount: 1 });
    expect((await listCustomerTickets(ana.id)).map((t) => t.id)).not.toContain(ticket.id);
    expect((await listCustomerTickets(luis.id)).map((t) => t.id)).toContain(ticket.id);

    // El QR/código de Ana ya no sirve; el de Luis sí.
    expect((await scanTicket({ sessionId: session.id, raw: ticket.code, method: "MANUAL" })).result).toBe("NOT_FOUND");
    expect((await scanTicket({ sessionId: session.id, raw: result.newCode, method: "MANUAL" })).result).toBe("ACCEPTED");
  });

  it("solo la persona a quien se ofreció la acepta, y una sola vez", async () => {
    const ana = await person("Ana");
    const luis = await person("Luis");
    const intruso = await person("Intruso");
    const { tickets } = await purchase(ana, 1);
    const offer = await createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: luis.email } });

    await expect(acceptTransfer(offer.transfer.id, intruso.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await acceptTransfer(offer.transfer.id, luis.id);
    await expect(acceptTransfer(offer.transfer.id, luis.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("si el titular ingresó antes de que aceptaran, la oferta ya no sirve", async () => {
    const ana = await person("Ana");
    const luis = await person("Luis");
    const { session, tickets } = await purchase(ana, 1);
    const offer = await createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: luis.email } });
    await scanTicket({ sessionId: session.id, raw: tickets[0]!.code, method: "MANUAL" });
    await expect(acceptTransfer(offer.transfer.id, luis.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await prisma.ticketTransfer.findUniqueOrThrow({ where: { id: offer.transfer.id } })).status).toBe("CANCELLED");
  });

  it("una oferta vencida no se acepta", async () => {
    const ana = await person("Ana");
    const luis = await person("Luis");
    const { tickets } = await purchase(ana, 1);
    const offer = await createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: luis.email } });
    await expect(acceptTransfer(offer.transfer.id, luis.id, new Date(Date.now() + 80 * 3_600_000))).rejects.toMatchObject({ message: expect.stringMatching(/venció/) });
    expect((await listTransfers(luis.id, new Date(Date.now() + 80 * 3_600_000))).incoming).toHaveLength(0);
  });

  it("rechazar o cancelar deja la entrada con quien la tenía", async () => {
    const ana = await person("Ana");
    const luis = await person("Luis");
    const { tickets } = await purchase(ana, 2);
    const first = await createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: luis.email } });
    await declineTransfer(first.transfer.id, luis.id);
    const second = await createTransfer({ ticketId: tickets[1]!.id, fromCustomerId: ana.id, to: { email: luis.email } });
    await cancelTransfer(second.transfer.id, ana.id);

    await expect(acceptTransfer(first.transfer.id, luis.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(cancelTransfer(second.transfer.id, luis.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await prisma.ticket.findMany({ where: { id: { in: tickets.map((t) => t.id) } } })).every((t) => t.customerId === ana.id)).toBe(true);
  });

  it("tiene un máximo de transferencias por entrada", async () => {
    const people = [await person("Ana"), await person("Beto"), await person("Carla")];
    const { tickets } = await purchase(people[0]!, 1);
    for (let i = 0; i < MAX_TRANSFERS_PER_TICKET; i++) {
      const offer = await createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: people[i]!.id, to: { email: people[i + 1]!.email } });
      await acceptTransfer(offer.transfer.id, people[i + 1]!.id);
    }
    await expect(createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: people[MAX_TRANSFERS_PER_TICKET]!.id, to: { email: people[0]!.email } })).rejects.toMatchObject({
      message: expect.stringMatching(/no se puede transferir más/),
    });
  });

  it("dos aceptaciones a la vez dejan una sola entrada nueva", async () => {
    const ana = await person("Ana");
    const luis = await person("Luis");
    const { tickets } = await purchase(ana, 1);
    const offer = await createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: luis.email } });
    const results = await Promise.allSettled([acceptTransfer(offer.transfer.id, luis.id), acceptTransfer(offer.transfer.id, luis.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0]!.id } })).transferCount).toBe(1);
  });
});

describe("la puerta se entera", () => {
  it("la descarga completa trae el código y el titular nuevos, y los cambios traen el código viejo como revocado", async () => {
    const ana = await person("Ana");
    const luis = await person("Luis");
    const { session, tickets } = await purchase(ana, 1);
    const oldCode = tickets[0]!.code;
    const before = new Date();
    const offer = await createTransfer({ ticketId: tickets[0]!.id, fromCustomerId: ana.id, to: { email: luis.email } });
    const { newCode } = await acceptTransfer(offer.transfer.id, luis.id);

    const full = (await getDoorDownload({ sessionId: session.id }))!;
    expect(full.tickets.map((t) => t.code)).toContain(newCode);
    expect(full.tickets.map((t) => t.code)).not.toContain(oldCode);
    expect(full.tickets.find((t) => t.code === newCode)).toMatchObject({ holder: "Luis", document: luis.documentId });

    const delta = (await getDoorDownload({ sessionId: session.id, since: before }))!;
    expect(delta.revoked).toEqual([oldCode]);
    expect(delta.tickets.map((t) => t.code)).toEqual([newCode]);
  });
});
