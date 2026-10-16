/**
 * Carga un organizador exportado con export-org.ts: recintos con su mapa, eventos, funciones, precios y
 * promociones. No borra nada: si el organizador ya existe (mismo slug), no hace nada.
 *
 * Opcional: su cuenta de organizador (solo lectura), con una contraseña temporal que se cambia al entrar:
 *   IMPORT_ADMIN_EMAIL=... IMPORT_ADMIN_PASSWORD='...' npm run db:import-org -w @ticketera/db -- prisma/organizers/soho.json
 *
 * En un servidor (NODE_ENV=production) exige además SEED_ALLOW=si.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { MIN_PASSWORD_LENGTH, mapItemsOf, slugify } from "@ticketera/core";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

type Exported = {
  version: number;
  organization: { name: string; slug: string; kind: "EVENTS" | "NIGHTLIFE"; currency: string; taxId: string | null; maxActiveEvents: number | null };
  venues: {
    name: string;
    address: string | null;
    city: string | null;
    timezone: string;
    /** Plano del boliche (archivos viejos no lo traen). */
    mapItems?: unknown;
    sections: {
      name: string;
      seatingMode: "GENERAL_ADMISSION" | "RESERVED";
      capacity: number;
      sortOrder: number;
      color: string;
      layout: unknown;
      seats: { row: string; number: string; label: string; x: number | null; y: number | null }[];
    }[];
    accessPoints: { name: string; sections: string[] }[];
  }[];
  events: {
    slug: string;
    title: string;
    description: string | null;
    imageUrl: string | null;
    category: string;
    status: string;
    mode: "TICKETING" | "GUEST_LIST";
    transfersEnabled: boolean;
    sessions: {
      venue: string;
      startsAt: string;
      endsAt: string | null;
      doorsOpenAt: string | null;
      /** Archivos viejos no la traen. */
      arrivalAt?: string | null;
      salesStartAt: string | null;
      salesEndAt: string | null;
      queueEnabled: boolean;
      maxConcurrentCheckouts: number | null;
      ticketTypes: (Record<string, unknown> & { section: string | null; name: string })[];
    }[];
  }[];
  promoCodes: (Record<string, unknown> & { event: string | null; code: string })[];
};

const date = (value: unknown) => (typeof value === "string" ? new Date(value) : null);

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW !== "si") {
    throw new Error("En un servidor, importar un organizador exige SEED_ALLOW=si (no borra nada).");
  }
  const file = process.argv[2];
  if (!file) throw new Error("Uso: npm run db:import-org -w @ticketera/db -- <archivo.json>");
  const data = JSON.parse(readFileSync(path.resolve(file), "utf8")) as Exported;
  if (data.version !== 1) throw new Error("Versión de archivo no soportada.");

  const adminEmail = process.env.IMPORT_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.IMPORT_ADMIN_PASSWORD ?? "";
  if (adminEmail && adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`IMPORT_ADMIN_PASSWORD necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  const db = await import("../src/index");
  const { prisma } = db;
  if (await prisma.organization.findUnique({ where: { slug: data.organization.slug } })) {
    console.log(`"${data.organization.name}" ya existe en esta base: no se cambió nada.`);
    await prisma.$disconnect();
    return;
  }
  if (adminEmail && (await prisma.staffUser.findUnique({ where: { email: adminEmail } }))) {
    throw new Error(`Ya existe una cuenta con el email ${adminEmail}.`);
  }

  const uniqueEventSlug = async (base: string) => {
    for (let n = 1; ; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      if (!(await prisma.event.findUnique({ where: { slug } }))) return slug;
    }
  };

  const summary = await prisma.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: data.organization.name,
          slug: data.organization.slug,
          kind: data.organization.kind,
          currency: data.organization.currency,
          taxId: data.organization.taxId,
          maxActiveEvents: data.organization.maxActiveEvents,
        },
      });

      const sectionIds = new Map<string, string>(); // "recinto/sección" → id
      const venueIds = new Map<string, string>();
      for (const v of data.venues) {
        const mapItems = mapItemsOf(v.mapItems);
        const venue = await tx.venue.create({
          data: { organizationId: org.id, name: v.name, address: v.address, city: v.city, timezone: v.timezone, mapItems: mapItems.length ? mapItems : undefined },
        });
        venueIds.set(v.name, venue.id);
        for (const s of v.sections) {
          const section = await tx.section.create({
            data: {
              venueId: venue.id,
              name: s.name,
              seatingMode: s.seatingMode,
              capacity: s.capacity,
              sortOrder: s.sortOrder,
              color: s.color,
              layout: s.layout === null ? undefined : (s.layout as object),
              seats: s.seats.length ? { createMany: { data: s.seats } } : undefined,
            },
          });
          sectionIds.set(`${v.name}/${s.name}`, section.id);
        }
        for (const a of v.accessPoints) {
          await tx.accessPoint.create({
            data: { venueId: venue.id, name: a.name, sections: { connect: a.sections.map((name) => ({ id: sectionIds.get(`${v.name}/${name}`)! })) } },
          });
        }
      }

      const eventIds = new Map<string, string>();
      let sessions = 0;
      for (const e of data.events) {
        const event = await tx.event.create({
          data: {
            organizationId: org.id,
            slug: await uniqueEventSlug(e.slug || slugify(e.title)),
            title: e.title,
            description: e.description,
            imageUrl: e.imageUrl,
            category: e.category as never,
            status: e.status as never,
            publishedAt: e.status === "PUBLISHED" ? new Date() : null,
            mode: e.mode,
            transfersEnabled: e.transfersEnabled,
          },
        });
        eventIds.set(e.slug, event.id);
        for (const s of e.sessions) {
          const venueId = venueIds.get(s.venue);
          if (!venueId) throw new Error(`La función de "${e.title}" usa un recinto que no está en el archivo: ${s.venue}`);
          await tx.eventSession.create({
            data: {
              eventId: event.id,
              venueId,
              startsAt: new Date(s.startsAt),
              endsAt: date(s.endsAt),
              doorsOpenAt: date(s.doorsOpenAt),
              arrivalAt: date(s.arrivalAt ?? null),
              salesStartAt: date(s.salesStartAt),
              salesEndAt: date(s.salesEndAt),
              queueEnabled: s.queueEnabled,
              maxConcurrentCheckouts: s.maxConcurrentCheckouts,
              ticketTypes: {
                create: s.ticketTypes.map((t) => ({
                  sectionId: t.section ? sectionIds.get(`${s.venue}/${t.section}`) ?? null : null,
                  name: t.name,
                  description: (t.description as string | null) ?? null,
                  unitAmount: t.unitAmount as number,
                  currency: t.currency as string,
                  capacity: t.capacity as number,
                  maxPerOrder: t.maxPerOrder as number,
                  salesStartAt: date(t.salesStartAt),
                  salesEndAt: date(t.salesEndAt),
                  presale: t.presale as boolean,
                  discountPercent: (t.discountPercent as number | null) ?? null,
                  discountStartsAt: date(t.discountStartsAt),
                  discountEndsAt: date(t.discountEndsAt),
                  sortOrder: t.sortOrder as number,
                  accessMethods: t.accessMethods as never,
                  qrMode: t.qrMode as never,
                  kind: t.kind as never,
                  peoplePerUnit: t.peoplePerUnit as number,
                  consumptionAmount: (t.consumptionAmount as number | null) ?? null,
                  entryUntil: date(t.entryUntil),
                })),
              },
            },
          });
          sessions++;
        }
      }

      for (const p of data.promoCodes) {
        await tx.promoCode.create({
          data: {
            organizationId: org.id,
            eventId: p.event ? eventIds.get(p.event) ?? null : null,
            code: p.code,
            description: (p.description as string | null) ?? null,
            discountType: p.discountType as never,
            discountValue: p.discountValue as number,
            combinableWithPresale: Boolean(p.combinableWithPresale),
            maxUses: (p.maxUses as number | null) ?? null,
            maxUsesPerCustomer: (p.maxUsesPerCustomer as number | null) ?? null,
            startsAt: date(p.startsAt),
            endsAt: date(p.endsAt),
            active: Boolean(p.active),
            promoterName: (p.promoterName as string | null) ?? null,
            commissionPercent: (p.commissionPercent as number | null) ?? null,
          },
        });
      }

      let admin: string | null = null;
      if (adminEmail) {
        await tx.staffUser.create({
          data: {
            email: adminEmail,
            name: process.env.IMPORT_ADMIN_NAME?.trim() || data.organization.name,
            passwordHash: await db.hashPassword(adminPassword),
            mustChangePassword: true,
            memberships: { create: { organizationId: org.id, role: "ADMIN" } },
          },
        });
        admin = adminEmail;
      }
      await tx.auditLog.create({
        data: { actorType: "system", action: "organizer.import", entity: "Organization", entityId: org.id, data: { file: path.basename(file), admin } },
      });
      return { venues: data.venues.length, events: data.events.length, sessions, admin };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  console.log(
    `Importado "${data.organization.name}": ${summary.venues} recinto(s), ${summary.events} evento(s), ${summary.sessions} función(es)` +
      (summary.admin ? `, cuenta ${summary.admin} (solo lectura; pide cambiar la contraseña al entrar).` : ". Sin cuenta: créala desde el panel."),
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
