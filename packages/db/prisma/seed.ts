/**
 * Datos de demostración para desarrollo (Bolivia). BORRA todo y vuelve a crear.
 *
 * Eventos, textos e imágenes tomados del prototipo del compañero; recintos con mapas de
 * butacas reales generados con la misma geometría que usa el editor del panel.
 *
 * Cuentas de prueba (solo desarrollo local):
 *   Panel   admin@impacta.test      / Impacta2026!    (OWNER)
 *   Puerta  puerta@impacta.test     / Puerta2026!     (OPERATOR: solo la app móvil de puerta)
 *   Sitio   comprador@impacta.test  / Comprador2026!
 *   + cliente y cajero: ver seed-demo.ts
 */
import path from "node:path";
import { config } from "dotenv";
import { seedArchitectureDemo, seedPassword } from "./seed-demo";
import {
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  SECTION_COLORS,
  computeSeatPositions,
  slugify,
  utcToZonedInput,
  zonedDateTimeToUtc,
  type SectionShape,
} from "@ticketera/core";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const bs = (amount: number) => Math.round(amount * 100); // bolivianos -> centavos

/** Fecha en hora de La Paz, a N días de hoy. */
function laPaz(daysFromNow: number, hour: number): Date {
  const today = utcToZonedInput(new Date(), DEFAULT_TIMEZONE).slice(0, 10);
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + daysFromNow);
  return zonedDateTimeToUtc(`${day.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00`, DEFAULT_TIMEZONE);
}

type SectionSeed =
  | { name: string; color: string; capacity: number }
  | { name: string; color: string; shape: SectionShape };

type VenueSeed = { key: string; name: string; address: string; city: string; sections: SectionSeed[]; gates: string[] };

const [AMBAR, ROSA, VERDE, AZUL, VIOLETA] = SECTION_COLORS as [string, string, string, string, string, string];

const VENUES: VenueSeed[] = [
  {
    key: "municipal",
    name: "Teatro Municipal Alberto Saavedra Pérez",
    address: "Calle Genaro Sanjinés",
    city: "La Paz",
    gates: ["Puerta principal", "Puerta lateral"],
    sections: [
      { name: "Platea", color: AMBAR, shape: { type: "grid", rows: 8, seatsPerRow: 16, x: 320, y: 200, seatGap: 24, rowGap: 26 } },
      { name: "Palco Izquierdo", color: ROSA, shape: { type: "grid", rows: 4, seatsPerRow: 4, x: 110, y: 150, seatGap: 24, rowGap: 26 } },
      { name: "Palco Derecho", color: ROSA, shape: { type: "grid", rows: 4, seatsPerRow: 4, x: 818, y: 150, seatGap: 24, rowGap: 26 } },
      {
        name: "Galería",
        color: AZUL,
        shape: { type: "arc", rows: 3, seatsPerRow: 24, centerX: 500, centerY: 40, startRadius: 470, rowGap: 26, startAngleDeg: 35, spanDeg: 110 },
      },
    ],
  },
  {
    key: "mariscal",
    name: "Teatro Gran Mariscal",
    address: "Av. Ballivián",
    city: "Cochabamba",
    gates: ["Puerta principal"],
    sections: [
      { name: "Platea", color: VERDE, shape: { type: "grid", rows: 6, seatsPerRow: 12, x: 368, y: 220, seatGap: 24, rowGap: 28 } },
      {
        name: "Palco",
        color: VIOLETA,
        shape: { type: "arc", rows: 2, seatsPerRow: 18, centerX: 500, centerY: 60, startRadius: 380, rowGap: 30, startAngleDeg: 45, spanDeg: 90 },
      },
    ],
  },
  {
    key: "sonilum-arena",
    name: "Sonilum Arena",
    address: "Av. San Martín",
    city: "Santa Cruz de la Sierra",
    gates: ["Acceso general", "Acceso VIP"],
    sections: [
      { name: "Cancha", color: AMBAR, capacity: 400 },
      { name: "VIP", color: ROSA, capacity: 60 },
    ],
  },
  {
    key: "arena26",
    name: "Arena 26",
    address: "Av. Cristo Redentor",
    city: "Santa Cruz de la Sierra",
    gates: ["Acceso norte", "Acceso sur"],
    sections: [
      { name: "Campo", color: VERDE, capacity: 800 },
      { name: "Palco", color: VIOLETA, capacity: 40 },
    ],
  },
  {
    key: "sonilum-plaza",
    name: "Sonilum Plaza",
    address: "4to Anillo",
    city: "Santa Cruz de la Sierra",
    gates: ["Acceso principal"],
    sections: [
      { name: "Pista", color: AZUL, capacity: 500 },
      { name: "VIP", color: ROSA, capacity: 100 },
    ],
  },
  {
    key: "tahuichi",
    name: 'Estadio "Tahuichi" Ramón Aguilera',
    address: "Av. Piraí",
    city: "Santa Cruz de la Sierra",
    gates: ["Puerta 1", "Puerta 2", "Puerta 3"],
    sections: [
      { name: "General", color: AMBAR, capacity: 3000 },
      { name: "Preferencial", color: AZUL, capacity: 500 },
    ],
  },
];

type TicketSeed = { name: string; section: string; price: number; capacity?: number; maxPerOrder?: number; salesEndsInDays?: number };

type EventSeed = {
  title: string;
  description: string;
  category: "CONCIERTO" | "TEATRO" | "FESTIVAL" | "DEPORTES" | "CONFERENCIA" | "FIESTA" | "ARTE" | "OTRO";
  imageUrl?: string;
  status?: "DRAFT" | "PUBLISHED";
  venue: string;
  sessions: { daysFromNow: number; hour: number; queue?: number }[];
  tickets: TicketSeed[];
};

const EVENTS: EventSeed[] = [
  {
    title: "Un Verano en el Illimani",
    description:
      "La banda más grande del rock boliviano vuelve a los escenarios con su gira 2026. Una noche de clásicos y canciones nuevas.",
    category: "CONCIERTO",
    imageUrl: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&q=80",
    venue: "sonilum-arena",
    sessions: [{ daysFromNow: 21, hour: 21 }],
    tickets: [
      { name: "General", section: "Cancha", price: 120 },
      { name: "VIP", section: "VIP", price: 350, maxPerOrder: 4 },
    ],
  },
  {
    title: "La Deliciosa Historia del Xocolate",
    description:
      "Una comedia musical que recorre la historia del chocolate boliviano, con elenco nacional y puesta en escena inmersiva.",
    category: "TEATRO",
    imageUrl: "https://images.unsplash.com/photo-1503095396549-807759245b35?w=1200&q=80",
    venue: "municipal",
    sessions: [
      { daysFromNow: 10, hour: 19 },
      { daysFromNow: 11, hour: 19 },
    ],
    tickets: [
      { name: "Platea", section: "Platea", price: 90, maxPerOrder: 6 },
      { name: "Palco", section: "Palco Izquierdo", price: 150, maxPerOrder: 4 },
      { name: "Palco", section: "Palco Derecho", price: 150, maxPerOrder: 4 },
      { name: "Galería", section: "Galería", price: 50, maxPerOrder: 6 },
    ],
  },
  {
    title: "Loko Fest — Edición Aniversario",
    description:
      "Tres escenarios, doce bandas y la mejor comida en food trucks. El festival independiente más esperado del año.",
    category: "FESTIVAL",
    imageUrl: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=1200&q=80",
    venue: "arena26",
    sessions: [{ daysFromNow: 35, hour: 16, queue: 150 }],
    tickets: [
      // Preventa y General comparten el aforo de 800 del Campo.
      { name: "Preventa", section: "Campo", price: 70, capacity: 300, salesEndsInDays: 20 },
      { name: "Entrada general", section: "Campo", price: 90, capacity: 800 },
      { name: "Palco", section: "Palco", price: 280, maxPerOrder: 4 },
    ],
  },
  {
    title: "Noche Electrónica: Alok Bolivia",
    description:
      "El DJ brasileño más escuchado del mundo llega por primera vez a Bolivia con un show de luces y sonido de nivel internacional.",
    category: "FIESTA",
    imageUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1200&q=80",
    venue: "sonilum-plaza",
    sessions: [{ daysFromNow: 18, hour: 22, queue: 80 }],
    tickets: [
      { name: "Entrada general", section: "Pista", price: 180 },
      { name: "VIP + barra libre", section: "VIP", price: 490, maxPerOrder: 4 },
    ],
  },
  {
    title: "Clásico Tahuichi: Copa de Leyendas",
    description:
      "Ex figuras del fútbol boliviano se enfrentan en un partido a beneficio de las escuelas deportivas del club.",
    category: "DEPORTES",
    imageUrl: "https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1200&q=80",
    venue: "tahuichi",
    sessions: [{ daysFromNow: 27, hour: 15 }],
    tickets: [
      { name: "General", section: "General", price: 30 },
      { name: "Preferencial", section: "Preferencial", price: 80 },
    ],
  },
  {
    title: "Piazzolla Sinfónico",
    description:
      "La Orquesta Sinfónica Nacional interpreta el tango de Astor Piazzolla en una noche íntima y sinfónica.",
    category: "ARTE",
    imageUrl: "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=1200&q=80",
    venue: "mariscal",
    sessions: [{ daysFromNow: 14, hour: 20 }],
    tickets: [
      { name: "Platea", section: "Platea", price: 150, maxPerOrder: 6 },
      { name: "Palco", section: "Palco", price: 220, maxPerOrder: 4 },
    ],
  },
  {
    title: "Stand-up: Risas de Altura",
    description: "Borrador de ejemplo: todavía no se ve en el sitio público. Publícalo desde el panel.",
    category: "OTRO",
    status: "DRAFT",
    venue: "sonilum-plaza",
    sessions: [{ daysFromNow: 40, hour: 21 }],
    tickets: [{ name: "General", section: "Pista", price: 60 }],
  },
];

async function main() {
  // En un servidor (NODE_ENV=production) solo con permiso explícito y contraseña propia: la
  // semilla borra todo y las contraseñas de prueba son públicas. Para un entorno de demo nuevo.
  if (process.env.NODE_ENV === "production") {
    if (process.env.SEED_ALLOW !== "si" || !process.env.SEED_PASSWORD) {
      throw new Error(
        "La semilla BORRA todos los datos. En un servidor, solo sobre una base nueva y con SEED_ALLOW=si y SEED_PASSWORD=<tu contraseña>.",
      );
    }
  }

  // Import dinámico: el cliente lee DATABASE_URL al cargarse, después de dotenv.
  const db = await import("../src/index");
  const { prisma, hashPassword } = db;

  await prisma.$transaction([
    prisma.accessScan.deleteMany(),
    prisma.ticket.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.order.deleteMany(),
    prisma.queueEntry.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.ticketType.deleteMany(),
    prisma.eventSession.deleteMany(),
    prisma.event.deleteMany(),
    prisma.seat.deleteMany(),
    prisma.section.deleteMany(),
    prisma.accessPoint.deleteMany(),
    prisma.venue.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.client.deleteMany(),
    prisma.staffUser.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.organization.deleteMany(),
  ]);

  const org = await prisma.organization.create({
    data: { name: "Impacta", slug: "impacta", currency: DEFAULT_CURRENCY, isPlatform: true },
  });

  await prisma.staffUser.create({
    data: {
      email: "admin@impacta.test",
      name: "Admin Impacta",
      passwordHash: await hashPassword(seedPassword("Impacta2026!")),
      emailVerified: true,
      memberships: { create: { organizationId: org.id, role: "OWNER" } },
    },
  });
  await prisma.staffUser.create({
    data: {
      email: "puerta@impacta.test",
      name: "Control de Puerta",
      passwordHash: await hashPassword(seedPassword("Puerta2026!")),
      memberships: { create: { organizationId: org.id, role: "OPERATOR" } },
    },
  });
  await prisma.customer.create({
    data: { email: "comprador@impacta.test", name: "Comprador Demo", passwordHash: await hashPassword(seedPassword("Comprador2026!")) },
  });

  // ── Recintos ──
  const venues = new Map<string, { id: string; sections: Map<string, { id: string; capacity: number }> }>();
  for (const v of VENUES) {
    const venue = await prisma.venue.create({
      data: {
        organizationId: org.id,
        name: v.name,
        address: v.address,
        city: v.city,
        timezone: DEFAULT_TIMEZONE,
        accessPoints: { create: v.gates.map((name) => ({ name })) },
      },
    });
    const sections = new Map<string, { id: string; capacity: number }>();
    for (const [i, s] of v.sections.entries()) {
      if ("capacity" in s) {
        const section = await prisma.section.create({
          data: { venueId: venue.id, name: s.name, color: s.color, seatingMode: "GENERAL_ADMISSION", capacity: s.capacity, sortOrder: i },
        });
        sections.set(s.name, { id: section.id, capacity: s.capacity });
      } else {
        const positions = computeSeatPositions(s.shape);
        const section = await prisma.section.create({
          data: {
            venueId: venue.id,
            name: s.name,
            color: s.color,
            seatingMode: "RESERVED",
            capacity: positions.length,
            layout: s.shape,
            sortOrder: i,
            seats: {
              createMany: {
                data: positions.map((p) => ({ ...p, label: `Fila ${p.row} · ${p.number}` })),
              },
            },
          },
        });
        sections.set(s.name, { id: section.id, capacity: positions.length });
      }
    }
    venues.set(v.key, { id: venue.id, sections });
  }

  // ── Eventos ──
  for (const e of EVENTS) {
    const venue = venues.get(e.venue)!;
    await prisma.event.create({
      data: {
        organizationId: org.id,
        slug: slugify(e.title),
        title: e.title,
        description: e.description,
        category: e.category,
        imageUrl: e.imageUrl,
        status: e.status ?? "PUBLISHED",
        publishedAt: e.status === "DRAFT" ? null : new Date(),
        sessions: {
          create: e.sessions.map((s) => ({
            venueId: venue.id,
            startsAt: laPaz(s.daysFromNow, s.hour),
            doorsOpenAt: laPaz(s.daysFromNow, s.hour - 1),
            queueEnabled: s.queue !== undefined,
            maxConcurrentCheckouts: s.queue,
            ticketTypes: {
              create: e.tickets.map((t, i) => {
                const section = venue.sections.get(t.section)!;
                return {
                  name: t.name,
                  sectionId: section.id,
                  unitAmount: bs(t.price),
                  currency: DEFAULT_CURRENCY,
                  capacity: t.capacity ?? section.capacity,
                  maxPerOrder: t.maxPerOrder ?? 10,
                  salesEndAt: t.salesEndsInDays === undefined ? null : laPaz(t.salesEndsInDays, 23),
                  presale: t.salesEndsInDays !== undefined,
                  sortOrder: i,
                };
              }),
            },
          })),
        },
      },
    });
  }

  // ── Cliente, cajero, puertas por sección y evento con lista de invitados ──
  await seedArchitectureDemo(db, org.id);

  const counts = {
    eventos: await prisma.event.count(),
    funciones: await prisma.eventSession.count(),
    tiposDeEntrada: await prisma.ticketType.count(),
    butacas: await prisma.seat.count(),
  };
  console.log("Semilla cargada:", counts);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
