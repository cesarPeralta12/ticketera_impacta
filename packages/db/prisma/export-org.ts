/**
 * Exporta la estructura de un organizador a un JSON, para cargarla en otro servidor con import-org.ts:
 * sus recintos con el mapa (secciones, butacas, zonas y puertas), eventos, funciones o noches, precios
 * (mesas, consumo, horarios) y códigos promocionales.
 *
 * No incluye cuentas, compras, entradas ni datos de compradores (el repositorio es público).
 *
 *   npm run db:export-org -w @ticketera/db -- <slug-del-organizador> [archivo.json]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("Uso: npm run db:export-org -w @ticketera/db -- <slug-del-organizador> [archivo.json]");
  const out = process.argv[3] ?? path.resolve(import.meta.dirname, "organizers", `${slug}.json`);
  const { prisma } = await import("../src/index");

  const org = await prisma.organization.findUnique({
    where: { slug },
    include: {
      venues: {
        orderBy: { createdAt: "asc" },
        include: {
          sections: { orderBy: { sortOrder: "asc" }, include: { seats: { orderBy: [{ row: "asc" }, { number: "asc" }] } } },
          accessPoints: { orderBy: { name: "asc" }, include: { sections: { select: { name: true } } } },
        },
      },
      events: {
        orderBy: { createdAt: "asc" },
        include: {
          sessions: {
            orderBy: { startsAt: "asc" },
            include: { venue: { select: { name: true } }, ticketTypes: { orderBy: { sortOrder: "asc" }, include: { section: { select: { name: true } } } } },
          },
        },
      },
      promoCodes: { include: { event: { select: { slug: true } } } },
    },
  });
  if (!org) throw new Error(`No existe el organizador "${slug}".`);
  if (org.isPlatform) throw new Error("La plataforma (Impacta) no se exporta.");

  const data = {
    version: 1,
    organization: { name: org.name, slug: org.slug, kind: org.kind, currency: org.currency, taxId: org.taxId, maxActiveEvents: org.maxActiveEvents },
    venues: org.venues.map((v) => ({
      name: v.name,
      address: v.address,
      city: v.city,
      timezone: v.timezone,
      sections: v.sections.map((s) => ({
        name: s.name,
        seatingMode: s.seatingMode,
        capacity: s.capacity,
        sortOrder: s.sortOrder,
        color: s.color,
        layout: s.layout,
        seats: s.seats.map((seat) => ({ row: seat.row, number: seat.number, label: seat.label, x: seat.x, y: seat.y })),
      })),
      accessPoints: v.accessPoints.map((a) => ({ name: a.name, sections: a.sections.map((s) => s.name) })),
    })),
    events: org.events.map((e) => ({
      slug: e.slug,
      title: e.title,
      description: e.description,
      imageUrl: e.imageUrl,
      category: e.category,
      status: e.status,
      mode: e.mode,
      transfersEnabled: e.transfersEnabled,
      sessions: e.sessions.map((s) => ({
        venue: s.venue.name,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        doorsOpenAt: s.doorsOpenAt,
        salesStartAt: s.salesStartAt,
        salesEndAt: s.salesEndAt,
        queueEnabled: s.queueEnabled,
        maxConcurrentCheckouts: s.maxConcurrentCheckouts,
        ticketTypes: s.ticketTypes.map((t) => ({
          section: t.section?.name ?? null,
          name: t.name,
          description: t.description,
          unitAmount: t.unitAmount,
          currency: t.currency,
          capacity: t.capacity,
          maxPerOrder: t.maxPerOrder,
          salesStartAt: t.salesStartAt,
          salesEndAt: t.salesEndAt,
          presale: t.presale,
          discountPercent: t.discountPercent,
          discountStartsAt: t.discountStartsAt,
          discountEndsAt: t.discountEndsAt,
          sortOrder: t.sortOrder,
          accessMethods: t.accessMethods,
          qrMode: t.qrMode,
          kind: t.kind,
          peoplePerUnit: t.peoplePerUnit,
          consumptionAmount: t.consumptionAmount,
          entryUntil: t.entryUntil,
        })),
      })),
    })),
    promoCodes: org.promoCodes.map((p) => ({
      event: p.event?.slug ?? null,
      code: p.code,
      description: p.description,
      discountType: p.discountType,
      discountValue: p.discountValue,
      combinableWithPresale: p.combinableWithPresale,
      maxUses: p.maxUses,
      maxUsesPerCustomer: p.maxUsesPerCustomer,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      active: p.active,
      promoterName: p.promoterName,
      commissionPercent: p.commissionPercent,
    })),
  };

  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  const seats = data.venues.reduce((n, v) => n + v.sections.reduce((m, s) => m + s.seats.length, 0), 0);
  const nights = data.events.reduce((n, e) => n + e.sessions.length, 0);
  console.log(`Exportado ${org.name} → ${path.relative(process.cwd(), out)}: ${data.venues.length} recinto(s), ${seats} butaca(s), ${data.events.length} evento(s), ${nights} función(es).`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
