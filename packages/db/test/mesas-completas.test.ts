/**
 * Mesas que se venden completas (Recintos → Mesas → «Mesa completa»): un círculo por mesa, un precio por mesa y una
 * entrada por persona. Se guardan como un grupo de lounges con sus personas, así que se venden igual que un lounge.
 */
import { afterAll, describe, expect, it } from "vitest";
import { parseWholeTables, randomCode, tableName } from "@ticketera/core";
import { prisma } from "../src/client";
import { createStaffUser } from "../src/operations/accounts";
import { sellAtBoxOffice } from "../src/operations/sales";

afterAll(() => prisma.$disconnect());

async function setup() {
  const suffix = randomCode(6).toLowerCase();
  const org = await prisma.organization.create({ data: { name: `Mesas ${suffix}`, slug: `mesas-${suffix}`, currency: "BOB" } });
  const staff = (await createStaffUser({ organizationId: org.id, name: "Caja", email: `caja-${suffix}@prueba.test`, password: "Prueba2026!", role: "ADMIN" }))!;
  const parsed = parseWholeTables({
    prefix: "Mesa",
    shape: "round",
    people: 10,
    tables: [1, 2, 3].map((n) => ({ number: n, x: 100 + n * 120, y: 200 })),
  });
  if (!parsed.ok) throw new Error(parsed.error);
  const venue = await prisma.venue.create({ data: { organizationId: org.id, name: "Salón", timezone: "America/La_Paz", accessPoints: { create: [{ name: "Puerta" }] } } });
  const section = await prisma.section.create({
    data: {
      venueId: venue.id,
      name: "Mesas",
      seatingMode: "RESERVED",
      capacity: parsed.tables.length,
      layout: parsed.layout,
      seats: { createMany: { data: parsed.tables.map((t) => ({ row: "L", number: String(t.number), label: tableName("Mesa", t.number), x: t.x, y: t.y })) } },
    },
    include: { seats: { orderBy: { number: "asc" } } },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      slug: `mesas-${suffix}`,
      title: `Gala ${suffix}`,
      status: "PUBLISHED",
      sessions: {
        create: {
          venueId: venue.id,
          startsAt: new Date(Date.now() + 10 * 86_400_000),
          ticketTypes: {
            create: { name: "Mesa", sectionId: section.id, unitAmount: 200_000, currency: "BOB", capacity: 3, maxPerOrder: 2, kind: "TABLE", peoplePerUnit: 10, consumptionAmount: 50_000 },
          },
        },
      },
    },
    include: { sessions: { include: { ticketTypes: true } } },
  });
  return { staff, session: event.sessions[0]!, type: event.sessions[0]!.ticketTypes[0]!, seats: section.seats };
}

describe("mesas que se venden completas", () => {
  it("dos mesas de 10 cobran dos veces el precio de la mesa y dan 20 entradas y dos consumos", async () => {
    const { staff, session, type, seats } = await setup();
    const sale = await sellAtBoxOffice(
      { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 2, seatIds: [seats[0]!.id, seats[2]!.id] }], buyer: { name: "Ana", email: "", document: "7654321" } },
      { staffId: staff.id, method: "EFECTIVO" },
    );
    const order = await prisma.order.findUniqueOrThrow({ where: { id: sale.id }, include: { tickets: { include: { credit: { include: { seat: true } } } } } });
    expect(order.totalAmount).toBe(400_000);
    expect(order.tickets).toHaveLength(20);
    const credits = [...new Map(order.tickets.map((t) => [t.creditId, t.credit!])).values()];
    expect(credits.map((c) => c.seat?.label).sort()).toEqual(["Mesa 1", "Mesa 3"]);
    expect(credits.every((c) => c.amount === 50_000)).toBe(true);

    // La mesa vendida ya no se puede volver a vender.
    await expect(
      sellAtBoxOffice(
        { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 1, seatIds: [seats[0]!.id] }], buyer: { name: "Otro", email: "", document: "7654322" } },
        { staffId: staff.id, method: "EFECTIVO" },
      ),
    ).rejects.toMatchObject({ code: "SEAT_TAKEN" });
  });
});
