/**
 * Entradas impresas: lote numerado que descuenta cupo, venta en mano por rango o código, recaudación al vender,
 * puerta según el modo (activadas al vender / válidas al imprimir), anulación que libera cupo y rendición.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { getDoorDownload } from "../src/operations/mobile";
import { getSessionAvailability } from "../src/operations/orders";
import { createPrintBatch, getPrintBatchReport, movePrintedTickets, settlePrintedSeller } from "../src/operations/printed";
import { getEventReport } from "../src/operations/report";
import { createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

async function staff() {
  return prisma.staffUser.create({ data: { email: `imprime-${randomCode(6).toLowerCase()}@prueba.test`, name: "Imprime", passwordHash: "!" } });
}

async function setup(capacity = 50) {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: capacity, types: [{ name: "General", capacity, unitAmount: 6_000 }] });
  return { session, type: types[0]!, staff: await staff() };
}

describe("lote de entradas impresas", () => {
  it("numera la serie, descuenta cupo y no se pasa del aforo", async () => {
    const { session, type, staff: s } = await setup(30);
    const batch = await createPrintBatch({ sessionId: session.id, ticketTypeId: type.id, quantity: 20, mode: "ACTIVATE_ON_SALE", staffId: s.id });
    expect(batch.prefix).toBe("A");
    const tickets = await prisma.ticket.findMany({ where: { printBatchId: batch.id }, orderBy: { serial: "asc" } });
    expect(tickets).toHaveLength(20);
    expect(tickets[0]!.serial).toBe("A-0001");
    expect(tickets[19]!.serial).toBe("A-0020");
    expect((await getSessionAvailability(session.id)).get(type.id)).toBe(10);

    await expect(createPrintBatch({ sessionId: session.id, ticketTypeId: type.id, quantity: 11, mode: "ACTIVATE_ON_SALE", staffId: s.id })).rejects.toMatchObject({
      code: "SOLD_OUT",
    });
    // El mismo prefijo sigue la numeración.
    const more = await createPrintBatch({ sessionId: session.id, ticketTypeId: type.id, quantity: 5, prefix: "a", mode: "ACTIVATE_ON_SALE", staffId: s.id });
    expect(more.firstNumber).toBe(21);
  });

  it("activadas al vender: no entran hasta venderse; la venta suma a la recaudación", async () => {
    const { session, type, staff: s } = await setup();
    const batch = await createPrintBatch({ sessionId: session.id, ticketTypeId: type.id, quantity: 10, mode: "ACTIVATE_ON_SALE", staffId: s.id });
    const [first, second] = await prisma.ticket.findMany({ where: { printBatchId: batch.id }, orderBy: { serial: "asc" }, take: 2 });

    expect((await scanTicket({ sessionId: session.id, raw: first!.code })).result).toBe("NOT_ACTIVATED");
    let download = await getDoorDownload({ sessionId: session.id });
    expect(download!.tickets.find((t) => t.code === first!.code)?.status).toBe("C");

    const sold = await movePrintedTickets({ batchId: batch.id, range: { from: 1, to: 3 }, action: { type: "SELL", method: "EFECTIVO" }, staffId: s.id });
    expect(sold.moved).toBe(3);
    download = await getDoorDownload({ sessionId: session.id });
    expect(download!.tickets.find((t) => t.code === first!.code)?.status).toBe("V");
    expect((await scanTicket({ sessionId: session.id, raw: first!.code })).result).toBe("ACCEPTED");

    // Vendida no se vuelve a vender; usada no se anula.
    const again = await movePrintedTickets({ batchId: batch.id, codes: [second!.code], action: { type: "SELL", method: "QR", amount: 5_000 }, staffId: s.id });
    expect(again.moved).toBe(0);
    expect(again.skipped[0]!.reason).toBe("está vendida");

    const report = await getPrintBatchReport(batch.id);
    expect(report!.counts).toMatchObject({ SOLD: 3, STOCK: 7 });
    expect(report!.revenue).toBe(18_000);
    const eventReport = await getEventReport(session.eventId);
    expect(eventReport!.byChannel.find((c) => c.channel === "PRINTED")).toMatchObject({ tickets: 10, sold: 3, revenue: 18_000 });
  });

  it("válidas al imprimir: entran sin venderse", async () => {
    const { session, type, staff: s } = await setup();
    const batch = await createPrintBatch({ sessionId: session.id, ticketTypeId: type.id, quantity: 2, mode: "VALID_ON_PRINT", staffId: s.id });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { printBatchId: batch.id } });
    expect((await scanTicket({ sessionId: session.id, raw: ticket.code })).result).toBe("ACCEPTED");
  });

  it("anular libera el cupo y la anulada no entra", async () => {
    const { session, type, staff: s } = await setup(10);
    const batch = await createPrintBatch({ sessionId: session.id, ticketTypeId: type.id, quantity: 10, mode: "VALID_ON_PRINT", staffId: s.id });
    expect((await getSessionAvailability(session.id)).get(type.id)).toBe(0);
    const voided = await movePrintedTickets({ batchId: batch.id, range: { from: 9, to: 10 }, action: { type: "VOID" }, staffId: s.id });
    expect(voided.moved).toBe(2);
    expect((await getSessionAvailability(session.id)).get(type.id)).toBe(2);
    const gone = await prisma.ticket.findFirstOrThrow({ where: { printBatchId: batch.id, serial: "A-0010" } });
    expect((await scanTicket({ sessionId: session.id, raw: gone.code })).result).toBe("CANCELLED");
  });

  it("entrega a vendedores y rendición con diferencia", async () => {
    const { session, type, staff: s } = await setup();
    const batch = await createPrintBatch({ sessionId: session.id, ticketTypeId: type.id, quantity: 20, mode: "ACTIVATE_ON_SALE", staffId: s.id });
    await movePrintedTickets({ batchId: batch.id, range: { from: 1, to: 10 }, action: { type: "ASSIGN", seller: "Ana RRPP" }, staffId: s.id });
    await movePrintedTickets({ batchId: batch.id, range: { from: 1, to: 6 }, action: { type: "SELL", method: "EFECTIVO" }, staffId: s.id });
    await movePrintedTickets({ batchId: batch.id, range: { from: 7, to: 8 }, action: { type: "RETURN" }, staffId: s.id });

    const report = await getPrintBatchReport(batch.id);
    expect(report!.sellers).toEqual([
      expect.objectContaining({ seller: "Ana RRPP", assigned: 10, inHand: 2, sold: 6, returned: 2, soldAmount: 36_000, received: 0, pending: 36_000 }),
    ]);
    const { difference } = await settlePrintedSeller({ batchId: batch.id, seller: "Ana RRPP", receivedAmount: 30_000, staffId: s.id });
    expect(difference).toBe(-6_000);
    const after = await getPrintBatchReport(batch.id);
    expect(after!.sellers[0]).toMatchObject({ received: 30_000, pending: 6_000 });
  });

  it("no imprime butacas ni mesas", async () => {
    const { session, staff: s } = await setup();
    const section = await prisma.section.create({ data: { venueId: session.venueId, name: `Platea ${randomCode(4)}`, seatingMode: "RESERVED", capacity: 1 } });
    const seated = await prisma.ticketType.create({ data: { sessionId: session.id, sectionId: section.id, name: "Platea", unitAmount: 1, currency: "CLP", capacity: 1 } });
    await expect(createPrintBatch({ sessionId: session.id, ticketTypeId: seated.id, quantity: 1, mode: "ACTIVATE_ON_SALE", staffId: s.id })).rejects.toMatchObject({
      code: "INVALID_ITEMS",
    });
  });
});
