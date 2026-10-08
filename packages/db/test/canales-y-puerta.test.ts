/**
 * Boletería, invitaciones, puertas con secciones asignadas y lecturas sin conexión,
 * contra PostgreSQL real.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { getEventReport } from "../src/operations/report";
import { cancelGuestTicket, issueGuestTickets, sellAtBoxOffice } from "../src/operations/sales";
import { buyer, createPendingOrder, createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

async function staff() {
  return prisma.staffUser.create({
    data: { email: `staff-${randomCode(6).toLowerCase()}@prueba.test`, name: "Staff", passwordHash: "!" },
  });
}

describe("boletería e invitaciones", () => {
  it("una venta de boletería queda pagada, con entradas y canal POS", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    const cashier = await staff();
    const order = await sellAtBoxOffice(
      { sessionId: session.id, items: [{ ticketTypeId: types[0]!.id, quantity: 3 }], buyer: { name: "Venta en caja", email: "caja@prueba.test", document: "7654321" } },
      { staffId: cashier.id, method: "EFECTIVO" },
    );
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: true, payments: true } });
    expect(saved.status).toBe("PAID");
    expect(saved.channel).toBe("POS");
    expect(saved.issuedById).toBe(cashier.id);
    expect(saved.tickets).toHaveLength(3);
    expect(saved.payments[0]!.provider).toBe("pos_efectivo");
  });

  it("boletería, online e invitaciones comparten el mismo cupo", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 5, types: [{ name: "General", capacity: 5 }] });
    const type = types[0]!;
    const who = await staff();
    await sellAtBoxOffice(
      { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 2 }], buyer: buyer(1) },
      { staffId: who.id, method: "QR" },
    );
    await issueGuestTickets({ ticketTypeId: type.id, guests: [{ name: "Ana" }, { name: "Luis" }], staffId: who.id });
    await createPendingOrder({ sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 1 }], buyer: buyer(2) });

    // 2 + 2 + 1 = 5: no queda lugar para nadie más, por ningún canal.
    await expect(
      issueGuestTickets({ ticketTypeId: type.id, guests: [{ name: "Extra" }], staffId: who.id }),
    ).rejects.toMatchObject({ code: "SOLD_OUT" });
    await expect(
      sellAtBoxOffice({ sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 1 }], buyer: buyer(3) }, { staffId: who.id, method: "TARJETA" }),
    ).rejects.toMatchObject({ code: "SOLD_OUT" });
  });

  it("anular una invitación libera su lugar y la invalida en puerta", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 1, types: [{ name: "Invitado", capacity: 1 }] });
    const who = await staff();
    await issueGuestTickets({ ticketTypeId: types[0]!.id, guests: [{ name: "Ana" }], staffId: who.id });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { sessionId: session.id } });

    await cancelGuestTicket({ ticketId: ticket.id, staffId: who.id });
    expect((await scanTicket({ sessionId: session.id, raw: ticket.code })).result).toBe("CANCELLED");
    await expect(
      issueGuestTickets({ ticketTypeId: types[0]!.id, guests: [{ name: "Luis" }], staffId: who.id }),
    ).resolves.toHaveLength(1);
  });

  it("online se corta al empezar la función; la boletería sigue vendiendo en puerta hasta que termina", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    const cashier = await staff();
    const start = new Date(Date.now() - 60 * 60_000); // empezó hace una hora
    await prisma.eventSession.update({ where: { id: session.id }, data: { startsAt: start, endsAt: null } });
    const items = [{ ticketTypeId: types[0]!.id, quantity: 1 }];

    await expect(createPendingOrder({ sessionId: session.id, items, buyer: buyer(1) })).rejects.toMatchObject({
      code: "NOT_ON_SALE",
    });
    await expect(
      sellAtBoxOffice({ sessionId: session.id, items, buyer: buyer(2) }, { staffId: cashier.id, method: "EFECTIVO" }),
    ).resolves.toMatchObject({ status: "PAID" });
    // Sin hora de fin, la boletería cierra 4 h después del inicio.
    await expect(
      sellAtBoxOffice(
        { sessionId: session.id, items, buyer: buyer(3) },
        { staffId: cashier.id, method: "EFECTIVO", now: new Date(start.getTime() + 4 * 60 * 60_000 + 1) },
      ),
    ).rejects.toMatchObject({ code: "NOT_ON_SALE" });
  });

  it("un evento de lista de invitados no se vende online", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "Invitado", capacity: 10 }] });
    await prisma.event.update({ where: { id: session.eventId }, data: { mode: "GUEST_LIST" } });
    await expect(
      createPendingOrder({ sessionId: session.id, items: [{ ticketTypeId: types[0]!.id, quantity: 1 }], buyer: buyer(1) }),
    ).rejects.toMatchObject({ code: "NOT_ON_SALE" });
  });

  it("el reporte separa canales, ingresados, ausentes y rechazos", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 20, types: [{ name: "General", capacity: 20, unitAmount: 5_000 }] });
    const who = await staff();
    await sellAtBoxOffice(
      { sessionId: session.id, items: [{ ticketTypeId: types[0]!.id, quantity: 2 }], buyer: buyer(1) },
      { staffId: who.id, method: "EFECTIVO" },
    );
    await issueGuestTickets({ ticketTypeId: types[0]!.id, guests: [{ name: "Ana" }], staffId: who.id });
    const [first] = await prisma.ticket.findMany({ where: { sessionId: session.id } });
    await scanTicket({ sessionId: session.id, raw: first!.code });
    await scanTicket({ sessionId: session.id, raw: first!.code }); // reingreso rechazado

    const report = await getEventReport(session.eventId);
    expect(report!.issued).toBe(3);
    expect(report!.used).toBe(1);
    expect(report!.absent).toBe(2);
    expect(report!.byChannel.find((c) => c.channel === "POS")).toMatchObject({ tickets: 2, revenue: 10_000 });
    expect(report!.byChannel.find((c) => c.channel === "GUEST")).toMatchObject({ tickets: 1, revenue: 0 });
    expect(report!.rejected).toEqual([{ result: "ALREADY_USED", count: 1 }]);
    expect(report!.pos).toEqual([{ cashier: "Staff", method: "efectivo", tickets: 2, revenue: 10_000 }]);
  });
});

describe("puertas", () => {
  it("una puerta con secciones asignadas rechaza entradas de otras secciones", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    const venueId = (await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id } })).venueId;
    const otherSection = await prisma.section.create({
      data: { venueId, name: "VIP", seatingMode: "GENERAL_ADMISSION", capacity: 5 },
    });
    const [puerta1, puerta2] = await prisma.accessPoint.findMany({ where: { venueId }, orderBy: { name: "asc" } });
    await prisma.accessPoint.update({ where: { id: puerta1!.id }, data: { sections: { set: [{ id: otherSection.id }] } } });
    await prisma.accessPoint.update({ where: { id: puerta2!.id }, data: { sections: { set: [{ id: types[0]!.sectionId! }] } } });

    const who = await staff();
    await issueGuestTickets({ ticketTypeId: types[0]!.id, guests: [{ name: "Ana" }], staffId: who.id });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { sessionId: session.id } });

    const wrong = await scanTicket({ sessionId: session.id, raw: ticket.code, accessPointId: puerta1!.id });
    expect(wrong.result).toBe("WRONG_GATE");
    expect(wrong.allowedGates).toEqual([puerta2!.name]);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("VALID");

    expect((await scanTicket({ sessionId: session.id, raw: ticket.code, accessPointId: puerta2!.id })).result).toBe("ACCEPTED");
  });

  it("una lectura sin conexión se sincroniza con su hora real; un doble ingreso offline queda registrado", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    const who = await staff();
    await issueGuestTickets({ ticketTypeId: types[0]!.id, guests: [{ name: "Ana" }], staffId: who.id });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { sessionId: session.id } });
    const at = new Date(Date.now() - 10 * 60_000);

    // Dos celulares sin internet aceptaron la misma entrada; sincronizan después.
    const a = await scanTicket({ sessionId: session.id, raw: ticket.code, deviceId: "cel-A", offline: true, scannedAt: at });
    const b = await scanTicket({ sessionId: session.id, raw: ticket.code, deviceId: "cel-B", offline: true, scannedAt: at });
    expect(a.result).toBe("ACCEPTED");
    expect(b.result).toBe("ALREADY_USED");

    const saved = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(saved.usedAt?.toISOString()).toBe(at.toISOString());
    const scans = await prisma.accessScan.findMany({ where: { ticketId: ticket.id }, orderBy: { deviceId: "asc" } });
    expect(scans.map((s) => [s.deviceId, s.offline, s.result])).toEqual([
      ["cel-A", true, "ACCEPTED"],
      ["cel-B", true, "ALREADY_USED"],
    ]);
  });

  it("reenviar la misma lectura al sincronizar no la duplica", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    const who = await staff();
    await issueGuestTickets({ ticketTypeId: types[0]!.id, guests: [{ name: "Ana" }], staffId: who.id });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { sessionId: session.id } });
    const scan = { sessionId: session.id, raw: ticket.code, deviceId: "cel-A", offline: true, clientScanId: `lec-${ticket.id}` };

    expect((await scanTicket(scan)).result).toBe("ACCEPTED");
    // Se cortó la red antes de recibir la respuesta: la app la vuelve a subir.
    expect((await scanTicket(scan)).result).toBe("ACCEPTED");
    expect(await prisma.accessScan.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it("un rechazo decidido sin conexión se registra sin marcar la entrada como usada", async () => {
    const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
    const who = await staff();
    await issueGuestTickets({ ticketTypeId: types[0]!.id, guests: [{ name: "Ana" }], staffId: who.id });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { sessionId: session.id } });

    // El celular no tenía esta entrada en su lista (se emitió después de sincronizar) y no la dejó pasar.
    const outcome = await scanTicket({ sessionId: session.id, raw: ticket.code, offline: true, offlineResult: "NOT_FOUND" });
    expect(outcome.result).toBe("NOT_FOUND");
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("VALID");
    const saved = await prisma.accessScan.findFirstOrThrow({ where: { ticketId: ticket.id } });
    expect([saved.result, saved.offline]).toEqual(["NOT_FOUND", true]);
  });
});
