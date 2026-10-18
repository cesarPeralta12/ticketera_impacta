/**
 * Mesas con sillas: la sección se vende como mesa completa, por silla o de N a M sillas de una misma mesa. La compra
 * online (y la boletería, que usa la misma reserva) rechaza lo que no cumple.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode, seatedTableSeats, seatedTablesGrid, type SeatedTablesLayout, type TableSaleMode } from "@ticketera/core";
import { prisma } from "../src/client";
import { buyer, createPendingOrder } from "./fixtures";

afterAll(() => prisma.$disconnect());

async function setup(mode: TableSaleMode, range: { min: number; max: number } = { min: 1, max: 4 }) {
  const suffix = randomCode(6).toLowerCase();
  const org = await prisma.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}`, currency: "BOB" } });
  const venue = await prisma.venue.create({ data: { organizationId: org.id, name: "Salón" } });
  const layout: SeatedTablesLayout = {
    type: "seated",
    prefix: "Mesa",
    shape: "round",
    chairs: 4,
    mode,
    min: mode === "RANGE" ? range.min : mode === "WHOLE" ? 4 : 1,
    max: mode === "RANGE" ? range.max : 4,
    size: 20,
    tables: seatedTablesGrid({ count: 3, perRow: 3, x: 150, y: 150, gapX: 150, gapY: 150 }),
  };
  const seats = seatedTableSeats(layout);
  const section = await prisma.section.create({
    data: { venueId: venue.id, name: "Mesas", seatingMode: "RESERVED", capacity: seats.length, layout, seats: { createMany: { data: seats } } },
    include: { seats: true },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      slug: `cena-${suffix}`,
      title: `Cena ${suffix}`,
      status: "PUBLISHED",
      sessions: {
        create: {
          venueId: venue.id,
          startsAt: new Date(Date.now() + 20 * 86_400_000),
          ticketTypes: { create: { name: "Mesa", sectionId: section.id, unitAmount: 10_000, currency: "BOB", capacity: seats.length } },
        },
      },
    },
    include: { sessions: { include: { ticketTypes: true } } },
  });
  const session = event.sessions[0]!;
  const chairs = (table: number) => section.seats.filter((s) => s.row === String(table)).map((s) => s.id);
  const buy = (n: number, seatIds: string[]) =>
    createPendingOrder({ sessionId: session.id, buyer: buyer(n), items: [{ ticketTypeId: session.ticketTypes[0]!.id, quantity: seatIds.length, seatIds }] });
  return { chairs, buy };
}

describe("mesas con sillas", () => {
  it("mesa completa: todas las sillas de la mesa, o nada", async () => {
    const { chairs, buy } = await setup("WHOLE");
    await expect(buy(1, chairs(1).slice(0, 2))).rejects.toMatchObject({ code: "INVALID_ITEMS", message: expect.stringContaining("completa") });
    const order = await buy(2, chairs(1));
    expect(order.status).toBe("PENDING_PAYMENT");
    // La mesa 1 ya está tomada; dos mesas completas en una compra (8 sillas) sí.
    await expect(buy(3, chairs(1))).rejects.toMatchObject({ code: "SEAT_TAKEN" });
    expect((await buy(4, [...chairs(2), ...chairs(3)])).status).toBe("PENDING_PAYMENT");
  });

  it("de N a M: entre 2 y 3 sillas por mesa", async () => {
    const { chairs, buy } = await setup("RANGE", { min: 2, max: 3 });
    await expect(buy(5, chairs(1).slice(0, 1))).rejects.toMatchObject({ message: expect.stringContaining("de 2 a 3") });
    await expect(buy(6, chairs(1))).rejects.toMatchObject({ message: expect.stringContaining("elegiste 4") });
    expect((await buy(7, [...chairs(1).slice(0, 2), ...chairs(2).slice(0, 3)])).status).toBe("PENDING_PAYMENT");
  });

  it("por silla: como butacas sueltas", async () => {
    const { chairs, buy } = await setup("SEAT");
    expect((await buy(8, [chairs(1)[0]!, chairs(3)[2]!])).status).toBe("PENDING_PAYMENT");
  });
});
