"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { slugify, zonedDateTimeToUtc } from "@ticketera/core";
import { EventCategory, prisma } from "@ticketera/db";
import { formObject, intField, moneyField, zodErrors, type FormState } from "@/lib/forms";
import { ROLES, requireStaff } from "@/lib/session";

async function audit(actorId: string, action: string, entity: string, entityId: string, data?: object) {
  await prisma.auditLog.create({
    data: { actorType: "staff", actorId, action, entity, entityId, data: data ? JSON.parse(JSON.stringify(data)) : undefined },
  });
}

const eventSchema = z.object({
  title: z.string({ error: "Ingresa un título." }).min(3, "El título es muy corto.").max(120),
  description: z.string().max(5000).optional(),
  category: z.enum(Object.values(EventCategory) as [EventCategory, ...EventCategory[]]),
  imageUrl: z
    .url({ protocol: /^https?$/, error: "La imagen debe ser una URL que empiece con http:// o https://" })
    .optional(),
});

async function uniqueSlug(title: string, excludeId?: string) {
  const base = slugify(title) || "evento";
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await prisma.event.findFirst({ where: { slug, id: excludeId ? { not: excludeId } : undefined } });
    if (!taken) return slug;
  }
}

/** Evento de la organización del usuario, o null (evita editar eventos de otra organización). */
async function ownedEvent(organizationId: string, eventId: string) {
  return prisma.event.findFirst({ where: { id: eventId, organizationId } });
}

export async function createEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const parsed = eventSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);

  const event = await prisma.event.create({
    data: {
      organizationId: staff.organization.id,
      slug: await uniqueSlug(parsed.data.title),
      ...parsed.data,
    },
  });
  await audit(staff.id, "event.create", "Event", event.id);
  redirect(`/eventos/${event.id}`);
}

export async function updateEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const event = await ownedEvent(staff.organization.id, String(formData.get("eventId")));
  if (!event) return { error: "Evento no encontrado." };
  const parsed = eventSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);

  await prisma.event.update({
    where: { id: event.id },
    data: { ...parsed.data, description: parsed.data.description ?? null, imageUrl: parsed.data.imageUrl ?? null },
  });
  await audit(staff.id, "event.update", "Event", event.id);
  revalidatePath(`/eventos/${event.id}`);
  return { ok: true };
}

/** Publica si cada función vigente tiene al menos un tipo de entrada (regla del prototipo). */
export async function publishEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const event = await prisma.event.findFirst({
    where: { id: String(formData.get("eventId")), organizationId: staff.organization.id },
    include: { sessions: { where: { cancelledAt: null }, include: { _count: { select: { ticketTypes: true } } } } },
  });
  if (!event) return { error: "Evento no encontrado." };
  if (event.sessions.length === 0) return { error: "Agrega al menos una función antes de publicar." };
  if (event.sessions.some((s) => s._count.ticketTypes === 0)) {
    return { error: "Todas las funciones necesitan al menos un tipo de entrada antes de publicar." };
  }

  await prisma.event.update({ where: { id: event.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
  await audit(staff.id, "event.publish", "Event", event.id);
  revalidatePath(`/eventos/${event.id}`);
  return { ok: true };
}

export async function unpublishEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const event = await ownedEvent(staff.organization.id, String(formData.get("eventId")));
  if (!event) return { error: "Evento no encontrado." };
  await prisma.event.update({ where: { id: event.id }, data: { status: "DRAFT" } });
  await audit(staff.id, "event.unpublish", "Event", event.id);
  revalidatePath(`/eventos/${event.id}`);
  return { ok: true };
}

const sessionSchema = z.object({
  eventId: z.string(),
  venueId: z.string({ error: "Elige un recinto." }),
  startsAt: z.string({ error: "Elige fecha y hora." }),
  doorsOpenAt: z.string().optional(),
});

export async function createSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const parsed = sessionSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { eventId, venueId, startsAt, doorsOpenAt } = parsed.data;

  const [event, venue] = await Promise.all([
    ownedEvent(staff.organization.id, eventId),
    prisma.venue.findFirst({ where: { id: venueId, organizationId: staff.organization.id } }),
  ]);
  if (!event || !venue) return { error: "Evento o recinto no encontrado." };

  // La hora que escribe el organizador es la del recinto, no la del servidor.
  let starts: Date;
  let doors: Date | undefined;
  try {
    starts = zonedDateTimeToUtc(startsAt, venue.timezone);
    doors = doorsOpenAt ? zonedDateTimeToUtc(doorsOpenAt, venue.timezone) : undefined;
  } catch {
    return { fieldErrors: { startsAt: "Fecha inválida." } };
  }
  if (starts <= new Date()) return { fieldErrors: { startsAt: "La función debe ser en el futuro." } };
  if (doors && doors > starts) return { fieldErrors: { doorsOpenAt: "Las puertas deben abrir antes de la función." } };

  const session = await prisma.eventSession.create({
    data: { eventId, venueId, startsAt: starts, doorsOpenAt: doors },
  });
  await audit(staff.id, "session.create", "EventSession", session.id);
  revalidatePath(`/eventos/${eventId}`);
  return { ok: true };
}

/** Solo se puede borrar una función sin ventas; con ventas habría que cancelarla y reembolsar. */
export async function deleteSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const session = await prisma.eventSession.findFirst({
    where: { id: String(formData.get("sessionId")), event: { organizationId: staff.organization.id } },
    include: { ticketTypes: { include: { _count: { select: { orderItems: true } } } } },
  });
  if (!session) return { error: "Función no encontrada." };
  if (session.ticketTypes.some((t) => t._count.orderItems > 0)) {
    return { error: "Esta función ya tiene órdenes: no se puede borrar." };
  }
  await prisma.eventSession.delete({ where: { id: session.id } });
  await audit(staff.id, "session.delete", "EventSession", session.id);
  redirect(`/eventos/${session.eventId}`);
}

const ticketTypeSchema = z.object({
  sessionId: z.string(),
  sectionId: z.string({ error: "Elige una sección." }),
  name: z.string({ error: "Ingresa un nombre." }).min(2).max(60),
  price: moneyField,
  capacity: intField(1, 200_000, "El cupo").optional(),
  maxPerOrder: intField(1, 10, "El máximo por compra"),
});

export async function addTicketTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const parsed = ticketTypeSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const data = parsed.data;

  const session = await prisma.eventSession.findFirst({
    where: { id: data.sessionId, event: { organizationId: staff.organization.id } },
  });
  const section = await prisma.section.findFirst({
    where: { id: data.sectionId, venueId: session?.venueId },
    include: { _count: { select: { seats: true } } },
  });
  if (!session || !section) return { error: "Función o sección no encontrada." };

  let capacity: number;
  if (section.seatingMode === "RESERVED") {
    // Una sección numerada tiene un solo precio por función: cada butaca es una entrada.
    const existing = await prisma.ticketType.count({ where: { sessionId: session.id, sectionId: section.id } });
    if (existing > 0) return { error: `"${section.name}" ya tiene precio en esta función.` };
    capacity = section._count.seats;
  } else {
    if (!data.capacity) return { fieldErrors: { capacity: "Ingresa el cupo." } };
    if (data.capacity > section.capacity) {
      return { fieldErrors: { capacity: `"${section.name}" admite como máximo ${section.capacity} personas.` } };
    }
    capacity = data.capacity;
  }

  const type = await prisma.ticketType.create({
    data: {
      sessionId: session.id,
      sectionId: section.id,
      name: data.name,
      unitAmount: data.price,
      currency: staff.organization.currency,
      capacity,
      maxPerOrder: data.maxPerOrder,
      sortOrder: await prisma.ticketType.count({ where: { sessionId: session.id } }),
    },
  });
  await audit(staff.id, "ticket_type.create", "TicketType", type.id, { price: data.price, capacity });
  revalidatePath(`/eventos/${session.eventId}/funciones/${session.id}`);
  return { ok: true };
}

export async function deleteTicketTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const type = await prisma.ticketType.findFirst({
    where: { id: String(formData.get("ticketTypeId")), session: { event: { organizationId: staff.organization.id } } },
    include: { session: true, _count: { select: { orderItems: true } } },
  });
  if (!type) return { error: "Tipo de entrada no encontrado." };
  if (type._count.orderItems > 0) return { error: "Ya tiene ventas: no se puede borrar." };
  await prisma.ticketType.delete({ where: { id: type.id } });
  await audit(staff.id, "ticket_type.delete", "TicketType", type.id);
  revalidatePath(`/eventos/${type.session.eventId}/funciones/${type.sessionId}`);
  return { ok: true };
}

const queueSchema = z
  .object({
    sessionId: z.string(),
    queueEnabled: z.literal("on").optional(),
    maxConcurrentCheckouts: intField(1, 10_000, "El cupo simultáneo").optional(),
  })
  .refine((d) => !d.queueEnabled || d.maxConcurrentCheckouts, {
    message: "Define cuántos compradores pueden comprar a la vez.",
    path: ["maxConcurrentCheckouts"],
  });

export async function updateQueueSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const parsed = queueSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const session = await prisma.eventSession.findFirst({
    where: { id: parsed.data.sessionId, event: { organizationId: staff.organization.id } },
  });
  if (!session) return { error: "Función no encontrada." };

  await prisma.eventSession.update({
    where: { id: session.id },
    data: {
      queueEnabled: Boolean(parsed.data.queueEnabled),
      maxConcurrentCheckouts: parsed.data.maxConcurrentCheckouts ?? null,
    },
  });
  await audit(staff.id, "session.queue", "EventSession", session.id, parsed.data);
  revalidatePath(`/eventos/${session.eventId}/funciones/${session.id}`);
  return { ok: true };
}
