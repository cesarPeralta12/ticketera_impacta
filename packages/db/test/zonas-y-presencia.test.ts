/**
 * Zonas de acceso, puertas de entrada y salida, reingreso por tipo de entrada, presencia (adentro / afuera y en qué
 * zona), aforo en vivo por zona, lo que baja la app de puerta y la corrección manual.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { getDoorDownload } from "../src/operations/mobile";
import { correctPresence, getTicketAccessHistory, getZoneOccupancy } from "../src/operations/presence";
import { issueGuestTickets } from "../src/operations/sales";
import { createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

async function staff() {
  return prisma.staffUser.create({ data: { email: `zonas-${randomCode(6).toLowerCase()}@prueba.test`, name: "Puerta", passwordHash: "!" } });
}

/** Evento con zonas General y VIP, una puerta de entrada general, una al VIP, una de salida y una de ida y vuelta. */
async function setup(opts: { maxEntries?: number } = {}) {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 50, types: [{ name: "General", capacity: 40 }, { name: "VIP", capacity: 10 }] });
  const venueId = session.venueId;
  const general = await prisma.accessZone.create({ data: { venueId, name: "General", level: 1, capacity: 40 } });
  const vip = await prisma.accessZone.create({ data: { venueId, name: "VIP", level: 2, capacity: 2 } });
  const [puerta1, puerta2] = await prisma.accessPoint.findMany({ where: { venueId }, orderBy: { name: "asc" } });
  const entrada = await prisma.accessPoint.update({ where: { id: puerta1!.id }, data: { zoneId: general.id } });
  const puertaVip = await prisma.accessPoint.update({ where: { id: puerta2!.id }, data: { zoneId: vip.id } });
  const salida = await prisma.accessPoint.create({ data: { venueId, name: "Salida", direction: "OUT" } });
  const idaYVuelta = await prisma.accessPoint.create({ data: { venueId, name: "Lateral", direction: "BOTH", zoneId: general.id } });
  const [generalType, vipType] = types;
  await prisma.ticketType.update({ where: { id: generalType!.id }, data: { maxEntries: opts.maxEntries ?? 1, zones: { connect: [{ id: general.id }] } } });
  await prisma.ticketType.update({ where: { id: vipType!.id }, data: { maxEntries: opts.maxEntries ?? 1, zones: { connect: [{ id: general.id }, { id: vip.id }] } } });
  const who = await staff();
  await issueGuestTickets({ ticketTypeId: generalType!.id, guests: [{ name: "Ana" }, { name: "Beto" }], staffId: who.id });
  await issueGuestTickets({ ticketTypeId: vipType!.id, guests: [{ name: "Vera" }], staffId: who.id });
  const tickets = await prisma.ticket.findMany({ where: { sessionId: session.id }, orderBy: { holderName: "asc" } });
  const [ana, beto, vera] = tickets;
  const scan = (ticket: { code: string }, gate: { id: string }) => scanTicket({ sessionId: session.id, raw: ticket.code, accessPointId: gate.id });
  return { session, zones: { general, vip }, gates: { entrada, puertaVip, salida, idaYVuelta }, ana: ana!, beto: beto!, vera: vera!, scan, who };
}

describe("presencia y reingreso", () => {
  it("sin reingreso (lo de siempre): sale y no vuelve a entrar", async () => {
    const { ana, gates, scan } = await setup();
    expect(await scan(ana, gates.entrada)).toMatchObject({ result: "ACCEPTED", movement: "ENTRY", zone: "General" });
    expect((await scan(ana, gates.entrada)).result).toBe("ALREADY_USED");
    expect(await scan(ana, gates.salida)).toMatchObject({ result: "ACCEPTED", movement: "EXIT" });
    expect((await scan(ana, gates.salida)).result).toBe("NOT_INSIDE");
    expect((await scan(ana, gates.entrada)).result).toBe("ALREADY_USED");
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ana.id } });
    expect(t).toMatchObject({ status: "USED", inside: false, entries: 1, zoneId: null });
  });

  it("con 2 ingresos: reingresa una vez; sin límite, siempre", async () => {
    const { ana, gates, scan } = await setup({ maxEntries: 2 });
    await scan(ana, gates.entrada);
    await scan(ana, gates.salida);
    expect(await scan(ana, gates.entrada)).toMatchObject({ result: "ACCEPTED", movement: "REENTRY" });
    await scan(ana, gates.salida);
    expect((await scan(ana, gates.entrada)).result).toBe("ALREADY_USED");

    const unlimited = await setup({ maxEntries: 0 });
    for (let i = 0; i < 4; i++) {
      expect((await unlimited.scan(unlimited.ana, unlimited.gates.entrada)).result).toBe("ACCEPTED");
      expect((await unlimited.scan(unlimited.ana, unlimited.gates.salida)).movement).toBe("EXIT");
    }
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: unlimited.ana.id } })).entries).toBe(4);
  });

  it("la puerta de ida y vuelta entra o saca según si está adentro", async () => {
    const { beto, gates, scan } = await setup({ maxEntries: 0 });
    expect((await scan(beto, gates.idaYVuelta)).movement).toBe("ENTRY");
    expect((await scan(beto, gates.idaYVuelta)).movement).toBe("EXIT");
    expect((await scan(beto, gates.idaYVuelta)).movement).toBe("REENTRY");
  });

  it("zonas: el VIP abre la puerta VIP y cambia de zona; la general no", async () => {
    const { session, ana, vera, gates, zones, scan } = await setup();
    const wrong = await scan(ana, gates.puertaVip);
    expect(wrong.result).toBe("WRONG_GATE");
    expect(wrong.allowedGates).toEqual(expect.arrayContaining([gates.entrada.name, gates.idaYVuelta.name]));
    expect(wrong.allowedGates).not.toContain(gates.salida.name);

    await scan(ana, gates.entrada);
    await scan(vera, gates.entrada);
    expect(await scan(vera, gates.puertaVip)).toMatchObject({ result: "ACCEPTED", movement: "ZONE_CHANGE", zone: "VIP" });
    // Ya está en el VIP: otra lectura en la misma puerta es "ya utilizada".
    expect((await scan(vera, gates.puertaVip)).result).toBe("ALREADY_USED");

    const occupancy = await getZoneOccupancy(session.id);
    expect(occupancy).toMatchObject({ inside: 2, entered: 2, exited: 0 });
    expect(occupancy!.zones.find((z) => z.id === zones.vip.id)).toMatchObject({ inside: 1, capacity: 2 });
    expect(occupancy!.zones.find((z) => z.id === zones.general.id)).toMatchObject({ inside: 1 });
  });

  it("la app baja como válida una entrada que salió y puede reingresar", async () => {
    const { session, ana, beto, gates, scan } = await setup({ maxEntries: 2 });
    await scan(ana, gates.entrada);
    await scan(ana, gates.salida);
    await scan(beto, gates.entrada);
    const download = await getDoorDownload({ sessionId: session.id });
    expect(download!.tickets.find((t) => t.code === ana.code)?.status).toBe("V");
    expect(download!.tickets.find((t) => t.code === beto.code)?.status).toBe("U");
    expect(download!.gates.find((g) => g.id === gates.salida.id)?.direction).toBe("OUT");

    // La app la deja pasar sin conexión; al sincronizar cuenta como reingreso.
    const synced = await scanTicket({ sessionId: session.id, raw: ana.code, accessPointId: gates.entrada.id, offline: true, scannedAt: new Date(), clientScanId: `z-${randomCode(8)}` });
    expect(synced).toMatchObject({ result: "ACCEPTED", movement: "REENTRY" });
  });

  it("después del último ingreso no reingresa, pero sí puede salir", async () => {
    const { session, ana, gates, scan } = await setup({ maxEntries: 0 });
    await scan(ana, gates.entrada);
    await prisma.eventSession.update({ where: { id: session.id }, data: { lastEntryAt: new Date(Date.now() - 60_000) } });
    expect((await scan(ana, gates.salida)).movement).toBe("EXIT");
    expect((await scan(ana, gates.entrada)).result).toBe("OUT_OF_HOURS");
  });
});

describe("corrección manual e historial", () => {
  it("marca afuera, adentro en una zona y 'no ingresó'; queda en el historial", async () => {
    const { ana, gates, zones, scan, who } = await setup();
    await scan(ana, gates.entrada);
    await correctPresence({ ticketId: ana.id, staffId: who.id, action: "OUT", reason: "salió por emergencia" });
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ana.id } })).toMatchObject({ inside: false, status: "USED" });
    await correctPresence({ ticketId: ana.id, staffId: who.id, action: "IN", zoneId: zones.vip.id, reason: "la pasamos al VIP" });
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ana.id } })).toMatchObject({ inside: true, zoneId: zones.vip.id });
    await correctPresence({ ticketId: ana.id, staffId: who.id, action: "RESET", reason: "se leyó por error" });
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ana.id } })).toMatchObject({ status: "VALID", inside: false, entries: 0 });
    await expect(correctPresence({ ticketId: ana.id, staffId: who.id, action: "OUT", reason: "x" })).rejects.toMatchObject({ code: "INVALID_STATE" });

    const history = await getTicketAccessHistory(ana.id);
    expect(history.map((h) => h.movement)).toEqual(["MANUAL", "MANUAL", "MANUAL", "ENTRY"]);
    expect(history[1]!.zone?.name).toBe("VIP");
    // Después de "no ingresó" vuelve a entrar normalmente.
    expect((await scan(ana, gates.entrada)).movement).toBe("ENTRY");
  });
});
