import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";

/**
 * Crea un evento publicado, aislado del resto, con una sección de entrada general y
 * tipos de entrada que comparten su aforo.
 */
export async function createGeneralAdmissionEvent(opts: {
  sectionCapacity: number;
  types: { name: string; capacity: number; unitAmount?: number }[];
}) {
  const suffix = randomCode(6).toLowerCase();
  const org = await prisma.organization.create({
    data: { name: `Org ${suffix}`, slug: `org-${suffix}`, currency: "CLP" },
  });
  const venue = await prisma.venue.create({
    data: {
      organizationId: org.id,
      name: "Recinto",
      timezone: "America/Santiago",
      accessPoints: { create: [{ name: "Puerta 1" }, { name: "Puerta 2" }] },
      sections: {
        create: { name: "Cancha", seatingMode: "GENERAL_ADMISSION", capacity: opts.sectionCapacity },
      },
    },
    include: { sections: true },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      slug: `evento-${suffix}`,
      title: `Evento ${suffix}`,
      status: "PUBLISHED",
      sessions: {
        create: {
          venueId: venue.id,
          startsAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
          ticketTypes: {
            create: opts.types.map((t) => ({
              name: t.name,
              sectionId: venue.sections[0]!.id,
              unitAmount: t.unitAmount ?? 10_000,
              currency: "CLP",
              capacity: t.capacity,
            })),
          },
        },
      },
    },
    include: { sessions: { include: { ticketTypes: true } } },
  });
  const session = event.sessions[0]!;
  return { session, types: session.ticketTypes };
}

/** Evento con una o más secciones de butacas numeradas y, opcionalmente, cola virtual. */
export async function createSeatedEvent(opts: { sections: { name: string; seats: number }[]; queue?: number }) {
  const suffix = randomCode(6).toLowerCase();
  const org = await prisma.organization.create({
    data: { name: `Org ${suffix}`, slug: `org-${suffix}`, currency: "BOB" },
  });
  const venue = await prisma.venue.create({ data: { organizationId: org.id, name: "Teatro" } });
  const sections = [];
  for (const s of opts.sections) {
    sections.push(
      await prisma.section.create({
        data: {
          venueId: venue.id,
          name: s.name,
          seatingMode: "RESERVED",
          capacity: s.seats,
          seats: {
            createMany: {
              data: Array.from({ length: s.seats }, (_, i) => ({ row: "A", number: String(i + 1), label: `A-${i + 1}` })),
            },
          },
        },
        include: { seats: { orderBy: { number: "asc" } } },
      }),
    );
  }
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      slug: `teatro-${suffix}`,
      title: `Teatro ${suffix}`,
      status: "PUBLISHED",
      sessions: {
        create: {
          venueId: venue.id,
          startsAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
          queueEnabled: opts.queue !== undefined,
          maxConcurrentCheckouts: opts.queue,
          ticketTypes: {
            create: sections.map((s) => ({
              name: s.name,
              sectionId: s.id,
              unitAmount: 9_000,
              currency: "BOB",
              capacity: s.seats.length,
            })),
          },
        },
      },
    },
    include: { sessions: { include: { ticketTypes: true } } },
  });
  const session = event.sessions[0]!;
  return {
    session,
    sections: sections.map((s) => ({
      ...s,
      ticketType: session.ticketTypes.find((t) => t.sectionId === s.id)!,
    })),
  };
}

export const buyer = (n: number) => ({ name: `Comprador ${n}`, email: `comprador${n}@prueba.test` });
