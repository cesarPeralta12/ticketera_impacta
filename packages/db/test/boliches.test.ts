/**
 * Boliches: mesas (un QR por persona, numeradas, aforo en personas), consumo incluido y su descuento en
 * barra, entradas gratis por horario (una por persona, vencen en puerta) y noches que se repiten.
 */
import { afterAll, describe, expect, it } from "vitest";
import { localWeekday, randomCode, utcToZonedInput } from "@ticketera/core";
import { prisma } from "../src/client";
import { scanTicket } from "../src/operations/access";
import { getDoorDownload } from "../src/operations/mobile";
import { duplicateSession, getConsumption, redeemConsumption, repeatWeeklyNights } from "../src/operations/nightlife";
import { createPendingOrder } from "../src/operations/orders";
import { applyPaymentUpdate, startPayment } from "../src/operations/payments";

afterAll(() => prisma.$disconnect());

const TZ = "America/La_Paz";
const unique = () => randomCode(6).toLowerCase();
const doc = () => String(1_000_000 + Math.floor(Math.random() * 8_999_999));

async function person(name = "Cliente") {
  return prisma.customer.create({
    data: { email: `${name.toLowerCase()}-${unique()}@prueba.test`, name, passwordHash: "!", documentId: doc(), emailVerified: true },
  });
}

async function bartender() {
  return prisma.staffUser.create({ data: { email: `barra-${unique()}@prueba.test`, name: "Barra", passwordHash: "!" } });
}

/** Un boliche con una noche: pista (aforo 100) y zona VIP (aforo 20) con mesas de 6. */
async function club(opts: { startsInDays?: number } = {}) {
  const suffix = unique();
  const org = await prisma.organization.create({ data: { name: `Club ${suffix}`, slug: `club-${suffix}`, currency: "BOB" } });
  const venue = await prisma.venue.create({
    data: {
      organizationId: org.id,
      name: "Boliche",
      timezone: TZ,
      accessPoints: { create: [{ name: "Puerta principal" }] },
      sections: {
        create: [
          { name: "Pista", seatingMode: "GENERAL_ADMISSION", capacity: 100 },
          { name: "VIP", seatingMode: "GENERAL_ADMISSION", capacity: 20 },
        ],
      },
    },
    include: { sections: true },
  });
  const pista = venue.sections.find((s) => s.name === "Pista")!;
  const vip = venue.sections.find((s) => s.name === "VIP")!;
  const startsAt = new Date(Date.now() + (opts.startsInDays ?? 7) * 86_400_000);
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      slug: `boliche-${suffix}`,
      title: `Boliche ${suffix}`,
      category: "BOLICHE",
      status: "PUBLISHED",
      sessions: {
        create: {
          venueId: venue.id,
          startsAt,
          ticketTypes: {
            create: [
              { name: "Free", sectionId: pista.id, unitAmount: 0, currency: "BOB", capacity: 50, maxPerOrder: 1, entryUntil: new Date(startsAt.getTime() + 2 * 3_600_000) },
              { name: "General", sectionId: pista.id, unitAmount: 5_000, currency: "BOB", capacity: 50 },
              { name: "Entrada + trago", sectionId: pista.id, unitAmount: 8_000, currency: "BOB", capacity: 50, consumptionAmount: 2_500 },
              {
                name: "Mesa VIP",
                sectionId: vip.id,
                unitAmount: 120_000,
                currency: "BOB",
                capacity: 5,
                maxPerOrder: 5,
                kind: "TABLE",
                peoplePerUnit: 6,
                consumptionAmount: 100_000,
              },
            ],
          },
        },
      },
    },
    include: { sessions: { include: { ticketTypes: true } } },
  });
  const session = event.sessions[0]!;
  const type = (name: string) => session.ticketTypes.find((t) => t.name === name)!;
  return { session, type };
}

/** Compra pagada (pase directo). Devuelve la orden y sus entradas. */
async function buy(customer: { id: string; name: string; email: string; documentId: string | null }, sessionId: string, ticketTypeId: string, quantity: number) {
  const order = await createPendingOrder(
    { sessionId, items: [{ ticketTypeId, quantity }], buyer: { name: customer.name, email: customer.email, document: customer.documentId ?? "" } },
    { customerId: customer.id },
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
  const tickets = await prisma.ticket.findMany({ where: { orderId: order.id }, orderBy: { issuedAt: "asc" }, include: { credit: true } });
  return { order, tickets };
}

describe("mesas", () => {
  it("cada mesa emite un QR por persona, con su número y un saldo de consumo compartido", async () => {
    const { session, type } = await club();
    const { tickets } = await buy(await person(), session.id, type("Mesa VIP").id, 2);

    expect(tickets).toHaveLength(12);
    const credits = [...new Map(tickets.map((t) => [t.creditId, t.credit!])).values()];
    expect(credits.map((c) => c.tableNumber).sort()).toEqual([1, 2]);
    expect(credits.every((c) => c.amount === 100_000 && c.spent === 0)).toBe(true);
    for (const credit of credits) expect(tickets.filter((t) => t.creditId === credit.id)).toHaveLength(6);

    // La siguiente compra sigue la numeración.
    const next = await buy(await person(), session.id, type("Mesa VIP").id, 1);
    expect(next.tickets[0]!.credit!.tableNumber).toBe(3);
  });

  it("una mesa ocupa en la zona los lugares de todas sus personas", async () => {
    const { session, type } = await club();
    // VIP para 20: 3 mesas de 6 son 18; una cuarta (6 más) no cabe aunque el cupo sea de 5 mesas.
    await buy(await person(), session.id, type("Mesa VIP").id, 3);
    await expect(buy(await person(), session.id, type("Mesa VIP").id, 1)).rejects.toMatchObject({ code: "SOLD_OUT" });
  });

  it("la puerta muestra la mesa de cada persona", async () => {
    const { session, type } = await club();
    const { tickets } = await buy(await person(), session.id, type("Mesa VIP").id, 1);
    const outcome = await scanTicket({ sessionId: session.id, raw: tickets[3]!.code });
    expect(outcome.result).toBe("ACCEPTED");
    expect(outcome.ticket?.seat).toBe("Mesa VIP N° 1");
    const download = await getDoorDownload({ sessionId: session.id });
    expect(download!.tickets.find((t) => t.code === tickets[0]!.code)).toMatchObject({ seat: "Mesa VIP N° 1" });
  });
});

describe("consumo en barra", () => {
  it("una entrada con trago abre su propio saldo", async () => {
    const { session, type } = await club();
    const { tickets } = await buy(await person(), session.id, type("Entrada + trago").id, 2);
    expect(new Set(tickets.map((t) => t.creditId)).size).toBe(2);
    expect(tickets.every((t) => t.credit?.amount === 2_500 && t.credit.tableNumber === null)).toBe(true);
  });

  it("descuenta con cualquier QR de la mesa y nunca deja pasarse del saldo", async () => {
    const { session, type } = await club();
    const staff = await bartender();
    const { tickets } = await buy(await person(), session.id, type("Mesa VIP").id, 1);

    const first = await redeemConsumption({ raw: tickets[0]!.code, sessionId: session.id, amount: 30_000, staffId: staff.id, note: "botella" });
    expect(first).toMatchObject({ spent: 30_000, left: 70_000 });
    // Otro QR de la misma mesa ve el mismo saldo.
    const seen = await getConsumption(tickets[5]!.code, session.id);
    expect(seen.ok && seen.credit.left).toBe(70_000);

    await expect(redeemConsumption({ raw: tickets[1]!.code, sessionId: session.id, amount: 80_000, staffId: staff.id })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(redeemConsumption({ raw: tickets[1]!.code, sessionId: session.id, amount: 0, staffId: staff.id })).rejects.toMatchObject({
      code: "INVALID_ITEMS",
    });
  });

  it("tres cobros a la vez sobre un saldo de dos: solo pasan dos", async () => {
    const { session, type } = await club();
    const staff = await bartender();
    const { tickets } = await buy(await person(), session.id, type("Mesa VIP").id, 1);
    await redeemConsumption({ raw: tickets[0]!.code, sessionId: session.id, amount: 40_000, staffId: staff.id });

    const results = await Promise.allSettled(
      [1, 2, 3].map((i) => redeemConsumption({ raw: tickets[i]!.code, sessionId: session.id, amount: 30_000, staffId: staff.id })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const credit = await prisma.consumptionCredit.findUniqueOrThrow({ where: { id: tickets[0]!.creditId! } });
    expect(credit.spent).toBe(100_000);
    expect(await prisma.consumptionRedemption.count({ where: { creditId: credit.id } })).toBe(3);
  });

  it("no cobra a una entrada de otra noche ni a una sin consumo", async () => {
    const a = await club();
    const b = await club();
    const customer = await person();
    const table = await buy(customer, a.session.id, a.type("Mesa VIP").id, 1);
    const general = await buy(customer, a.session.id, a.type("General").id, 1);
    expect(await getConsumption(table.tickets[0]!.code, b.session.id)).toMatchObject({ ok: false, reason: "Esa entrada es de otra noche." });
    expect(await getConsumption(general.tickets[0]!.code, a.session.id)).toMatchObject({ ok: false, reason: "Esa entrada no tiene consumo incluido." });
    expect(await getConsumption("NOEXISTE00", a.session.id)).toMatchObject({ ok: false });
  });
});

describe("free por horario", () => {
  it("es una por persona en cada noche", async () => {
    const { session, type } = await club();
    const ana = await person("Ana");
    await expect(buy(ana, session.id, type("Free").id, 2)).rejects.toMatchObject({ code: "INVALID_ITEMS" });
    await buy(ana, session.id, type("Free").id, 1);
    await expect(buy(ana, session.id, type("Free").id, 1)).rejects.toMatchObject({ code: "INVALID_ITEMS" });
    await buy(await person("Luis"), session.id, type("Free").id, 1);
  });

  it("pasada la hora: no se vende, no entra y baja anulada a la app de puerta", async () => {
    const { session, type } = await club();
    const free = type("Free");
    const { tickets } = await buy(await person(), session.id, free.id, 1);
    const late = await buy(await person(), session.id, free.id, 1);
    const deadline = new Date(Date.now() - 60_000);
    await prisma.ticketType.update({ where: { id: free.id }, data: { entryUntil: deadline } });

    await expect(buy(await person(), session.id, free.id, 1)).rejects.toMatchObject({ code: "NOT_ON_SALE" });

    const download = await getDoorDownload({ sessionId: session.id });
    expect(download!.tickets.find((t) => t.code === tickets[0]!.code)?.status).toBe("C");
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0]!.id } })).toMatchObject({ status: "CANCELLED" });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0]!.id } })).expiredAt).not.toBeNull();

    // En vivo, después de la hora: fuera de horario.
    expect((await scanTicket({ sessionId: session.id, raw: tickets[0]!.code })).result).toBe("OUT_OF_HOURS");
    // Una lectura sin conexión hecha antes de la hora vale aunque se sincronice después.
    const offline = await scanTicket({
      sessionId: session.id,
      raw: late.tickets[0]!.code,
      offline: true,
      scannedAt: new Date(deadline.getTime() - 5 * 60_000),
      clientScanId: `scan-${unique()}`,
    });
    expect(offline.result).toBe("ACCEPTED");
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: late.tickets[0]!.id } })).toMatchObject({ status: "USED", expiredAt: null });
  });

  it("antes de la hora entra normal", async () => {
    const { session, type } = await club();
    const { tickets } = await buy(await person(), session.id, type("Free").id, 1);
    expect((await scanTicket({ sessionId: session.id, raw: tickets[0]!.code })).result).toBe("ACCEPTED");
  });
});

describe("repetir noches", () => {
  it("copia precios, mesas, consumo y horarios a las próximas semanas, sin duplicar", async () => {
    const { session, type } = await club({ startsInDays: 2 });
    const staff = await bartender();
    const day = localWeekday(session.startsAt, TZ);
    const next = (day + 1) % 7;

    const first = await repeatWeeklyNights({ templateSessionId: session.id, weekdays: [day, next], weeks: 2, staffId: staff.id });
    expect(first).toEqual({ created: 4, skipped: 0 });
    const again = await repeatWeeklyNights({ templateSessionId: session.id, weekdays: [day, next], weeks: 2, staffId: staff.id });
    expect(again).toEqual({ created: 0, skipped: 4 });

    const nights = await prisma.eventSession.findMany({
      where: { eventId: session.eventId },
      orderBy: { startsAt: "asc" },
      include: { ticketTypes: { orderBy: { sortOrder: "asc" } } },
    });
    expect(nights).toHaveLength(5);
    const oneWeek = nights.find((n) => n.startsAt.getTime() === session.startsAt.getTime() + 7 * 86_400_000)!;
    expect(oneWeek).toBeDefined();
    const mesa = oneWeek.ticketTypes.find((t) => t.name === "Mesa VIP")!;
    expect(mesa).toMatchObject({ kind: "TABLE", peoplePerUnit: 6, consumptionAmount: 100_000, capacity: 5, unitAmount: 120_000 });
    const freeCopy = oneWeek.ticketTypes.find((t) => t.name === "Free")!;
    expect(freeCopy.entryUntil!.getTime() - oneWeek.startsAt.getTime()).toBe(type("Free").entryUntil!.getTime() - session.startsAt.getTime());
  });
});

describe("último ingreso de la función", () => {
  it("pasada la hora: no entra, baja anulada a la app y no se vende; la free sigue con su propio horario", async () => {
    const { session, type } = await club();
    const general = await buy(await person(), session.id, type("General").id, 1);
    const free = await buy(await person(), session.id, type("Free").id, 1);
    // La free tiene su horario (dentro de 2 h desde el inicio): ese manda sobre el de la función.
    await prisma.eventSession.update({ where: { id: session.id }, data: { lastEntryAt: new Date(Date.now() - 60_000) } });

    await expect(buy(await person(), session.id, type("General").id, 1)).rejects.toMatchObject({ code: "NOT_ON_SALE" });
    const download = await getDoorDownload({ sessionId: session.id });
    expect(download!.tickets.find((t) => t.code === general.tickets[0]!.code)?.status).toBe("C");
    expect((await scanTicket({ sessionId: session.id, raw: general.tickets[0]!.code })).result).toBe("OUT_OF_HOURS");
    expect(download!.tickets.find((t) => t.code === free.tickets[0]!.code)?.status).not.toBe("C");
    expect((await scanTicket({ sessionId: session.id, raw: free.tickets[0]!.code })).result).toBe("ACCEPTED");
  });

  it("antes del último ingreso entra normal", async () => {
    const { session, type } = await club();
    await prisma.eventSession.update({ where: { id: session.id }, data: { lastEntryAt: new Date(Date.now() + 3_600_000) } });
    const { tickets } = await buy(await person(), session.id, type("General").id, 1);
    expect((await scanTicket({ sessionId: session.id, raw: tickets[0]!.code })).result).toBe("ACCEPTED");
  });
});

describe("nueva noche", () => {
  it("copia una noche a otro día a la misma hora, con sus precios y horarios corridos", async () => {
    const { session, type } = await club({ startsInDays: 2 });
    await prisma.eventSession.update({
      where: { id: session.id },
      data: { doorsOpenAt: new Date(session.startsAt.getTime() - 3_600_000), arrivalAt: new Date(session.startsAt.getTime() - 1_800_000), endsAt: new Date(session.startsAt.getTime() + 5 * 3_600_000) },
    });
    const staff = await bartender();
    const date = utcToZonedInput(new Date(session.startsAt.getTime() + 3 * 86_400_000), TZ).slice(0, 10);

    const copy = await duplicateSession({ templateSessionId: session.id, date, staffId: staff.id });
    const night = await prisma.eventSession.findUniqueOrThrow({ where: { id: copy.id }, include: { ticketTypes: true } });
    const delta = 3 * 86_400_000;
    expect(night.startsAt.getTime()).toBe(session.startsAt.getTime() + delta);
    expect(night.arrivalAt!.getTime()).toBe(session.startsAt.getTime() - 1_800_000 + delta);
    expect(night.endsAt!.getTime()).toBe(session.startsAt.getTime() + 5 * 3_600_000 + delta);
    expect(night.ticketTypes).toHaveLength(4);
    const free = night.ticketTypes.find((t) => t.name === "Free")!;
    expect(free.entryUntil!.getTime()).toBe(type("Free").entryUntil!.getTime() + delta);

    await expect(duplicateSession({ templateSessionId: session.id, date, staffId: staff.id })).rejects.toThrow(/Ya hay una función/);
    await expect(duplicateSession({ templateSessionId: session.id, date: "2020-01-01", staffId: staff.id })).rejects.toThrow(/ya pasó/);
  });
});

describe("venta online durante la noche", () => {
  it("con cierre de venta después del inicio se sigue vendiendo; sin él, no", async () => {
    const { session, type } = await club({ startsInDays: 1 });
    const started = new Date(Date.now() - 3_600_000);
    await prisma.eventSession.update({ where: { id: session.id }, data: { startsAt: started, endsAt: new Date(Date.now() + 4 * 3_600_000) } });
    const buyer = await person("Tarde");
    await expect(buy(buyer, session.id, type("General").id, 1)).rejects.toThrow(/no está a la venta/);

    await prisma.eventSession.update({ where: { id: session.id }, data: { salesEndAt: new Date(Date.now() + 3_600_000) } });
    const { tickets } = await buy(buyer, session.id, type("General").id, 1);
    expect(tickets).toHaveLength(1);
  });
});

describe("mesas elegidas en el mapa", () => {
  /** Boliche con un "lounge" de 4 mesas dibujadas como butacas, cada una para 2 personas. */
  async function lounge() {
    const suffix = unique();
    const org = await prisma.organization.create({ data: { name: `Lounge ${suffix}`, slug: `lounge-${suffix}`, currency: "BOB", kind: "NIGHTLIFE" } });
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: "Lounge", timezone: TZ, accessPoints: { create: [{ name: "Puerta" }] } } });
    const section = await prisma.section.create({
      data: {
        venueId: venue.id,
        name: "lounge",
        seatingMode: "RESERVED",
        capacity: 4,
        seats: { createMany: { data: Array.from({ length: 4 }, (_, i) => ({ row: "A", number: String(i + 1), label: `A-${i + 1}` })) } },
      },
      include: { seats: { orderBy: { number: "asc" } } },
    });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        slug: `lounge-${suffix}`,
        title: `Lounge ${suffix}`,
        category: "BOLICHE",
        status: "PUBLISHED",
        sessions: {
          create: {
            venueId: venue.id,
            startsAt: new Date(Date.now() + 7 * 86_400_000),
            ticketTypes: {
              create: {
                name: "VIP",
                sectionId: section.id,
                unitAmount: 50_000,
                currency: "BOB",
                capacity: 4,
                maxPerOrder: 4,
                kind: "TABLE",
                peoplePerUnit: 2,
                consumptionAmount: 40_000,
              },
            },
          },
        },
      },
      include: { sessions: { include: { ticketTypes: true } } },
    });
    return { session: event.sessions[0]!, type: event.sessions[0]!.ticketTypes[0]!, seats: section.seats };
  }

  it("cada mesa elegida trae un QR por persona, su saldo y queda tomada en el mapa", async () => {
    const { session, type, seats } = await lounge();
    const customer = await person();
    const order = await createPendingOrder(
      { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 2, seatIds: [seats[0]!.id, seats[2]!.id] }], buyer: { name: customer.name, email: customer.email, document: customer.documentId! } },
      { customerId: customer.id },
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

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id }, include: { credit: { include: { seat: true } } } });
    expect(tickets).toHaveLength(4);
    const credits = [...new Map(tickets.map((t) => [t.creditId, t.credit!])).values()];
    expect(credits.map((c) => c.seat?.label).sort()).toEqual(["A-1", "A-3"]);
    expect(credits.every((c) => c.amount === 40_000 && c.tableNumber === null)).toBe(true);
    // Una sola entrada por butaca (la barrera contra la doble venta); las demás comparten la mesa.
    expect(tickets.filter((t) => t.seatId).length).toBe(2);

    // Esas mesas ya no se pueden elegir.
    const other = await person();
    await expect(
      createPendingOrder(
        { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 1, seatIds: [seats[0]!.id] }], buyer: { name: other.name, email: other.email, document: other.documentId! } },
        { customerId: other.id },
      ),
    ).rejects.toMatchObject({ code: "SEAT_TAKEN" });

    const second = tickets.find((t) => !t.seatId && t.credit?.seat?.label === "A-3")!;
    const outcome = await scanTicket({ sessionId: session.id, raw: second.code });
    expect(outcome).toMatchObject({ result: "ACCEPTED", ticket: { seat: "VIP · A-3" } });
    const seen = await getConsumption(second.code, session.id);
    expect(seen.ok && seen.credit.seat?.label).toBe("A-3");
  });
});
