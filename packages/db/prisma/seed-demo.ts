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
  data: { email: string; name: string; password: string; role: "CLIENT" | "CASHIER"; clientId?: string },
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

  return log;
}
