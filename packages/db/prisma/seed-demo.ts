/**
 * Datos de demostración de la arquitectura IMPACTA: un cliente con su cuenta, un cajero,
 * puertas con secciones asignadas y un evento con lista de invitados.
 *
 * Solo AGREGA (no borra nada) y se puede correr varias veces: lo usa la semilla completa y
 * también `npm run db:demo`, que lo carga sobre una base existente sin tocar lo demás.
 *
 * Cuentas de prueba (solo desarrollo local):
 *   Cliente  cliente@impacta.test  / Cliente2026!   (CLIENT: Producciones Andinas)
 *   Cajero   caja@impacta.test     / Caja2026!      (CASHIER: solo boletería)
 *   Organizador  organizador@andeslive.test / Organizador2026!  (ADMIN de "Andes Live")
 *   Organizador  organizador@cumbre.test    / Organizador2026!  (ADMIN de "Cumbre Eventos")
 * Con SEED_PASSWORD definida, todas las cuentas usan esa contraseña (ver seedPassword).
 */
import {
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  MIN_PASSWORD_LENGTH,
  slugify,
  utcToZonedInput,
  zonedDateTimeToUtc,
} from "@ticketera/core";

type Db = typeof import("../src/index");

/**
 * Contraseña de las cuentas de demostración. Las de prueba están publicadas en el README:
 * en un servidor accesible desde internet se usa SEED_PASSWORD para no dejarlas abiertas.
 */
export function seedPassword(localDefault: string) {
  const custom = process.env.SEED_PASSWORD?.trim();
  if (!custom) return localDefault;
  if (custom.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_PASSWORD debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  return custom;
}

/** Fecha en hora de La Paz, a N días de hoy. */
function laPaz(daysFromNow: number, hour: number): Date {
  const today = utcToZonedInput(new Date(), DEFAULT_TIMEZONE).slice(0, 10);
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + daysFromNow);
  return zonedDateTimeToUtc(`${day.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00`, DEFAULT_TIMEZONE);
}

const GUESTS = [
  { name: "María Fernanda Rojas", email: "mfrojas@prensa.bo", document: "4567812" },
  { name: "Jorge Luis Mamani", email: "jmamani@radio.bo" },
  { name: "Carla Gutiérrez", document: "6234981" },
  { name: "Andrés Quiroga", email: "aquiroga@revista.bo" },
  { name: "Paola Vargas" },
  { name: "Diego Choque", email: "dchoque@tv.bo", document: "5123764" },
  { name: "Valeria Antezana" },
  { name: "Rodrigo Salazar", email: "rsalazar@agencia.bo" },
];

async function ensureStaff(
  db: Db,
  orgId: string,
  data: { email: string; name: string; password: string; role: "CLIENT" | "CASHIER" | "ADMIN" | "OPERATOR"; clientId?: string },
) {
  // Devuelve la cuenta solo si la creó (si ya existía, no la toca).
  if (await db.prisma.staffUser.findUnique({ where: { email: data.email } })) return null;
  return db.prisma.staffUser.create({
    data: {
      email: data.email,
      name: data.name,
      passwordHash: await db.hashPassword(data.password),
      memberships: { create: { organizationId: orgId, role: data.role, clientId: data.clientId ?? null } },
    },
  });
}

export async function seedArchitectureDemo(db: Db, orgId: string) {
  const { prisma } = db;
  const log: string[] = [];

  // ── Cliente / organizador y sus cuentas ──
  const key = { organizationId_name: { organizationId: orgId, name: "Producciones Andinas" } };
  let client = await prisma.client.findUnique({ where: key });
  if (!client) {
    client = await prisma.client.create({
      data: { organizationId: orgId, name: "Producciones Andinas", taxId: "1023456027", contactEmail: "contacto@andinas.bo" },
    });
    log.push("cliente Producciones Andinas");
  }
  if (
    await ensureStaff(db, orgId, {
      email: "cliente@impacta.test",
      name: "Lucía Andrade (Producciones Andinas)",
      password: seedPassword("Cliente2026!"),
      role: "CLIENT",
      clientId: client.id,
    })
  ) {
    log.push("cuenta del cliente");
  }
  if (await ensureStaff(db, orgId, { email: "caja@impacta.test", name: "Cajero Demo", password: seedPassword("Caja2026!"), role: "CASHIER" })) {
    log.push("cuenta de cajero");
  }

  // ── El festival es del cliente, con su espacio abierto hasta 24 h después ──
  const fest = await prisma.event.findFirst({
    where: { organizationId: orgId, slug: slugify("Loko Fest — Edición Aniversario") },
  });
  if (fest && !fest.clientId) {
    await prisma.event.update({
      where: { id: fest.id },
      data: { clientId: client.id, clientAccessEnabled: true, clientAccessUntil: await db.defaultClientAccessUntil(fest.id) },
    });
    log.push(`"${fest.title}" asignado al cliente`);
  }

  // ── Puertas con secciones: en Arena 26 cada acceso tiene su sector ──
  const arena = await prisma.venue.findFirst({
    where: { organizationId: orgId, name: "Arena 26" },
    include: { sections: true, accessPoints: { include: { sections: true } } },
  });
  if (arena) {
    const plan: Record<string, string> = { "Acceso norte": "Campo", "Acceso sur": "Palco" };
    for (const gate of arena.accessPoints) {
      const section = arena.sections.find((s) => s.name === plan[gate.name]);
      if (section && gate.sections.length === 0) {
        await prisma.accessPoint.update({ where: { id: gate.id }, data: { sections: { set: [{ id: section.id }] } } });
        log.push(`${gate.name} → ${section.name}`);
      }
    }

    // Cómo se lee cada sector en puerta (demostración de la app móvil).
    const methodsBySection: Record<string, ("QR" | "BARCODE" | "NFC")[]> = {
      Campo: ["QR", "BARCODE", "NFC"],
      Palco: ["QR", "BARCODE"],
    };
    for (const [sectionName, methods] of Object.entries(methodsBySection)) {
      const section = arena.sections.find((s) => s.name === sectionName);
      if (section) await prisma.ticketType.updateMany({ where: { sectionId: section.id }, data: { accessMethods: methods } });
    }

    // Una cuenta de portero por puerta: cada una descarga solo las entradas de su puerta.
    await ensureStaff(db, orgId, { email: "puerta.sur@impacta.test", name: "Puerta Acceso sur", password: seedPassword("Puerta2026!"), role: "OPERATOR" });
    const sessions = await prisma.eventSession.findMany({ where: { venueId: arena.id }, select: { id: true } });
    const perGate: [string, string][] = [
      ["puerta@impacta.test", "Acceso norte"],
      ["puerta.sur@impacta.test", "Acceso sur"],
    ];
    for (const [email, gateName] of perGate) {
      const doorman = await prisma.staffUser.findUnique({ where: { email } });
      const gate = arena.accessPoints.find((g) => g.name === gateName);
      if (!doorman || !gate) continue;
      for (const session of sessions) {
        await prisma.doorAssignment.upsert({
          where: { userId_sessionId: { userId: doorman.id, sessionId: session.id } },
          create: { userId: doorman.id, sessionId: session.id, accessPointId: gate.id },
          update: { accessPointId: gate.id },
        });
      }
      log.push(`${email} → ${gateName} (${sessions.length} función(es))`);
    }
  }

  // ── Evento con lista de invitados (sin venta) ──
  const guestSlug = slugify("Lanzamiento Andino: cóctel de prensa");
  const plaza = await prisma.venue.findFirst({
    where: { organizationId: orgId, name: "Sonilum Plaza" },
    include: { sections: { where: { name: "VIP", seatingMode: "GENERAL_ADMISSION" } } },
  });
  const vip = plaza?.sections[0];
  const exists = await prisma.event.findUnique({ where: { slug: guestSlug } });
  if (plaza && vip && !exists) {
    const startsAt = laPaz(7, 19);
    const event = await prisma.event.create({
      data: {
        organizationId: orgId,
        clientId: client.id,
        mode: "GUEST_LIST",
        slug: guestSlug,
        title: "Lanzamiento Andino: cóctel de prensa",
        description: "Presentación de la temporada 2027 de Producciones Andinas. Solo con invitación.",
        category: "OTRO",
        status: "PUBLISHED",
        publishedAt: new Date(),
        clientAccessEnabled: true,
        clientAccessUntil: new Date(startsAt.getTime() + 24 * 60 * 60_000),
        sessions: {
          create: {
            venueId: plaza.id,
            startsAt,
            doorsOpenAt: laPaz(7, 18),
            ticketTypes: {
              create: {
                name: "Invitado",
                sectionId: vip.id,
                unitAmount: 0,
                currency: DEFAULT_CURRENCY,
                capacity: 80,
                maxPerOrder: 1,
              },
            },
          },
        },
      },
      include: { sessions: { include: { ticketTypes: true } } },
    });
    const admin = await prisma.membership.findFirst({ where: { organizationId: orgId, role: "OWNER" } });
    if (admin) {
      await db.issueGuestTickets({ ticketTypeId: event.sessions[0]!.ticketTypes[0]!.id, guests: GUESTS, staffId: admin.userId });
    }
    log.push(`"${event.title}" con ${GUESTS.length} invitados`);
  }

  // ── Preventas: los tipos "Preventa" con fecha de fin se muestran como tales ──
  const presales = await prisma.ticketType.updateMany({
    where: { name: "Preventa", salesEndAt: { not: null }, presale: false, session: { event: { organizationId: orgId } } },
    data: { presale: true },
  });
  if (presales.count) log.push(`${presales.count} preventa(s) marcada(s)`);

  log.push(...(await seedOrganizers(db)));
  log.push(...(await seedSalesDemo(db, orgId)));
  return log;
}

/**
 * Dos organizadores de ejemplo, cada uno aislado del otro: Andes Live con un evento con
 * preventa esperando la aprobación de IMPACTA, y Cumbre Eventos con un evento publicado.
 */
async function seedOrganizers(db: Db) {
  const { prisma } = db;
  const log: string[] = [];
  const organizers = [
    {
      slug: "andes-live",
      name: "Andes Live Producciones",
      taxId: "3456789012",
      email: "organizador@andeslive.test",
      admin: "Mariana Quispe (Andes Live)",
      venue: { name: "Coliseo Julio Borelli", city: "La Paz", section: "Cancha", capacity: 600 },
      event: {
        title: "Festival Andes Live 2026",
        description: "Rock y fusión andina en un solo escenario: seis bandas bolivianas en vivo.",
        category: "FESTIVAL" as const,
        imageUrl: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1200&q=80",
        status: "PENDING_REVIEW" as const,
        days: 45,
      },
    },
    {
      slug: "cumbre-eventos",
      name: "Cumbre Eventos",
      taxId: "4567890123",
      email: "organizador@cumbre.test",
      admin: "Carlos Mendoza (Cumbre Eventos)",
      venue: { name: "Salón Cumbre", city: "Cochabamba", section: "General", capacity: 250 },
      event: {
        title: "Noche de Gala Cumbre",
        description: "Cena show con orquesta en vivo. Una noche para celebrar.",
        category: "CONCIERTO" as const,
        imageUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&q=80",
        status: "PUBLISHED" as const,
        days: 30,
      },
    },
  ];

  for (const o of organizers) {
    if (await prisma.organization.findUnique({ where: { slug: o.slug } })) continue;
    const organization = await prisma.organization.create({
      data: { name: o.name, slug: o.slug, currency: DEFAULT_CURRENCY, taxId: o.taxId, contactEmail: o.email },
    });
    await ensureStaff(db, organization.id, {
      email: o.email,
      name: o.admin,
      password: seedPassword("Organizador2026!"),
      role: "ADMIN",
    });
    const venue = await prisma.venue.create({
      data: {
        organizationId: organization.id,
        name: o.venue.name,
        city: o.venue.city,
        timezone: DEFAULT_TIMEZONE,
        accessPoints: { create: [{ name: "Puerta principal" }] },
        sections: {
          create: {
            name: o.venue.section,
            seatingMode: "GENERAL_ADMISSION",
            capacity: o.venue.capacity,
            layout: { type: "zone", shape: "rect", x: 150, y: 160, width: 700, height: 380 },
          },
        },
      },
      include: { sections: true },
    });
    const section = venue.sections[0]!;
    const presaleEnds = laPaz(Math.min(15, o.event.days - 5), 23);
    await prisma.event.create({
      data: {
        organizationId: organization.id,
        slug: slugify(o.event.title),
        title: o.event.title,
        description: o.event.description,
        category: o.event.category,
        imageUrl: o.event.imageUrl,
        status: o.event.status,
        publishedAt: o.event.status === "PUBLISHED" ? new Date() : null,
        submittedAt: o.event.status === "PENDING_REVIEW" ? new Date() : null,
        sessions: {
          create: {
            venueId: venue.id,
            startsAt: laPaz(o.event.days, 21),
            doorsOpenAt: laPaz(o.event.days, 19),
            ticketTypes: {
              create: [
                // Preventa más barata hasta una fecha; la General empieza cuando termina.
                {
                  name: "Preventa",
                  sectionId: section.id,
                  unitAmount: 6_000,
                  currency: DEFAULT_CURRENCY,
                  capacity: Math.floor(o.venue.capacity / 3),
                  presale: true,
                  salesEndAt: presaleEnds,
                  sortOrder: 0,
                },
                {
                  name: "General",
                  sectionId: section.id,
                  unitAmount: 9_000,
                  currency: DEFAULT_CURRENCY,
                  capacity: o.venue.capacity,
                  salesStartAt: presaleEnds,
                  sortOrder: 1,
                },
              ],
            },
          },
        },
      },
    });
    log.push(`organizador ${o.name} (${o.event.status === "PUBLISHED" ? "evento publicado" : "evento esperando aprobación"})`);
  }
  return log;
}

/**
 * Compradores verificados, un descuento de preventa sobre la misma entrada, códigos promocionales
 * (uno con promotor) y compras pagadas para ver ventas, entradas y la lectura en puerta.
 */
async function seedSalesDemo(db: Db, orgId: string) {
  const { prisma } = db;
  const log: string[] = [];

  const buyers = [
    { email: "comprador2@impacta.test", name: "Camila Rojas", documentId: "7654321" },
    { email: "comprador3@impacta.test", name: "Marcelo Flores", documentId: "8123456" },
  ];
  for (const b of buyers) {
    if (await prisma.customer.findUnique({ where: { email: b.email } })) continue;
    await prisma.customer.create({
      data: { ...b, emailVerified: true, passwordHash: await db.hashPassword(seedPassword("Comprador2026!")) },
    });
    log.push(`comprador ${b.email}`);
  }

  // Descuento de preventa sobre la misma entrada (Noche Electrónica: general -15% durante 10 días).
  const alok = await prisma.event.findFirst({ where: { organizationId: orgId, slug: slugify("Noche Electrónica: Alok Bolivia") } });
  if (alok) {
    const r = await prisma.ticketType.updateMany({
      where: { name: "Entrada general", discountPercent: null, session: { eventId: alok.id } },
      data: { discountPercent: 15, discountStartsAt: new Date(), discountEndsAt: laPaz(10, 23) },
    });
    if (r.count) log.push("descuento de preventa 15% en Noche Electrónica");
  }

  const owner = await prisma.membership.findFirst({ where: { organizationId: orgId, role: "OWNER" } });
  const fest = await prisma.event.findFirst({ where: { organizationId: orgId, slug: slugify("Loko Fest — Edición Aniversario") } });
  if (owner && !(await prisma.promoCode.findFirst({ where: { organizationId: orgId } }))) {
    await db.createPromoCode(orgId, { code: "IMPACTA10", description: "10% en todos los eventos", discountType: "PERCENT", discountValue: 10 }, owner.userId);
    await db.createPromoCode(
      orgId,
      {
        code: "LOKO20",
        description: "Promotor del Loko Fest",
        eventId: fest?.id ?? null,
        discountType: "PERCENT",
        discountValue: 20,
        maxUses: 100,
        maxUsesPerCustomer: 4,
        promoterName: "Rodrigo (RRPP)",
        commissionPercent: 10,
      },
      owner.userId,
    );
    log.push("códigos IMPACTA10 y LOKO20");
  }

  // Compras pagadas (pase directo) para tener entradas que leer en la puerta.
  if (fest && (await prisma.order.count({ where: { items: { some: { ticketType: { session: { eventId: fest.id } } } } } })) === 0) {
    const session = await prisma.eventSession.findFirst({ where: { eventId: fest.id }, include: { ticketTypes: true } });
    const general = session?.ticketTypes.find((t) => t.name === "Entrada general");
    const palco = session?.ticketTypes.find((t) => t.name === "Palco");
    const orders = [
      { email: "comprador@impacta.test", type: general, qty: 2, promo: "LOKO20" },
      { email: "comprador2@impacta.test", type: palco, qty: 1, promo: undefined },
      { email: "comprador3@impacta.test", type: general, qty: 3, promo: undefined },
    ];
    // La cola virtual no aplica a estas compras de demostración: se apaga un momento.
    await prisma.eventSession.update({ where: { id: session!.id }, data: { queueEnabled: false } });
    for (const o of orders) {
      const customer = await prisma.customer.findUnique({ where: { email: o.email } });
      if (!session || !o.type || !customer) continue;
      const order = await db.createPendingOrder(
        {
          sessionId: session.id,
          items: [{ ticketTypeId: o.type.id, quantity: o.qty }],
          buyer: { name: customer.name, email: customer.email, document: customer.documentId ?? "" },
        },
        { customerId: customer.id, promoCode: o.promo },
      );
      const payment = await db.startPayment(order.code, "directo");
      await db.applyPaymentUpdate({
        paymentId: payment.id,
        provider: "directo",
        providerPaymentId: `directo_${payment.id}`,
        status: "APPROVED",
        providerStatus: "pase_directo",
        amount: payment.amount,
        currency: payment.currency,
      });
    }
    await prisma.eventSession.update({ where: { id: session!.id }, data: { queueEnabled: session!.queueEnabled } });
    log.push(`${orders.length} compras pagadas en Loko Fest`);
  }
  return log;
}
