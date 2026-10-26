"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  DEFAULT_TIMEZONE,
  MAX_DISCOUNT_PERCENT,
  MIN_AGE_OPTIONS,
  entryDeadline,
  isSeatedTablesLayout,
  isTablesLayout,
  isTimeOfDay,
  normalizeImageUrl,
  parseProgram,
  parseSalesWindow,
  parseSessionTimes,
  sessionNoun,
  slugify,
  utcToZonedInput,
  windowsOverlap,
  zonedDateTimeToUtc,
} from "@ticketera/core";
import {
  DomainError,
  EventCategory,
  EventMode,
  Prisma,
  createEventWithinLimit,
  duplicateSession,
  prisma,
  publicationProblem,
  setTicketTypeQrMode,
  submitEventForReview,
} from "@ticketera/db";
import { formObject, intField, moneyField, zodErrors, type FormState } from "@/lib/forms";
import { allowedCategories, requireEditor } from "@/lib/session";
import { logAudit } from "@/lib/audit";

async function audit(actorId: string, action: string, entity: string, entityId: string, data?: object) {
  await logAudit({ actorType: "staff", actorId, action, entity, entityId, data: data ? JSON.parse(JSON.stringify(data)) : undefined });
}

const eventSchema = z.object({
  title: z.string({ error: "Ingresa un título." }).min(3, "El título es muy corto.").max(120),
  description: z.string().max(5000).optional(),
  category: z.enum(Object.values(EventCategory) as [EventCategory, ...EventCategory[]]),
  // Si pegan el enlace de la página de Google/Bing Imágenes, se guarda la imagen real.
  imageUrl: z
    .string()
    .transform(normalizeImageUrl)
    .pipe(z.url({ protocol: /^https?$/, error: "La imagen debe ser una URL que empiece con http:// o https://" }))
    .optional(),
  mode: z.enum(Object.values(EventMode) as [EventMode, ...EventMode[]]).default("TICKETING"),
  clientId: z.string().optional(),
  /** Casilla "permitir transferir entradas": sin marcar, el navegador no la envía. */
  transfersEnabled: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
  /** Casilla "evento pequeño": sale también con el filtro "Eventos pequeños" de la web. */
  small: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
  // Condiciones y contacto (todo opcional; vacío = no se muestra).
  minAge: z.coerce.number().int().refine((n) => (MIN_AGE_OPTIONS as readonly number[]).includes(n), "Edad no válida.").optional(),
  requiredDocument: z.string().max(120).optional(),
  dressCode: z.string().max(200).optional(),
  forbiddenItems: z.string().max(300).optional(),
  reentryPolicy: z.string().max(300).optional(),
  refundPolicy: z.string().max(2000).optional(),
  contactPhone: z.string().max(40).optional(),
  contactEmail: z.email("Correo de consultas inválido.").max(120).optional(),
});

/** Los campos opcionales que se dejaron vacíos se guardan vacíos (null), para poder borrarlos. */
function eventData(data: z.infer<typeof eventSchema>) {
  return {
    ...data,
    description: data.description ?? null,
    imageUrl: data.imageUrl ?? null,
    minAge: data.minAge ?? null,
    requiredDocument: data.requiredDocument ?? null,
    dressCode: data.dressCode ?? null,
    forbiddenItems: data.forbiddenItems ?? null,
    reentryPolicy: data.reentryPolicy ?? null,
    refundPolicy: data.refundPolicy ?? null,
    contactPhone: data.contactPhone ?? null,
    contactEmail: data.contactEmail?.toLowerCase() ?? null,
  };
}

/** El cliente elegido tiene que ser de la organización; vacío = evento propio de IMPACTA. */
async function checkClient(organizationId: string, clientId: string | undefined) {
  if (!clientId) return { ok: true as const, clientId: null };
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId } });
  return client ? { ok: true as const, clientId: client.id } : { ok: false as const };
}

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
  const staff = await requireEditor();
  const parsed = eventSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  if (!allowedCategories(staff).includes(parsed.data.category)) return { fieldErrors: { category: "Categoría no disponible para este organizador." } };
  const client = await checkClient(staff.organization.id, parsed.data.clientId);
  if (!client.ok) return { fieldErrors: { clientId: "Cliente no encontrado." } };

  let event;
  try {
    // IMPACTA no tiene tope (puede trabajar dentro de un organizador sin importar su límite); el organizador, sí.
    event = await createEventWithinLimit(
      {
        organizationId: staff.organization.id,
        slug: await uniqueSlug(parsed.data.title),
        ...eventData(parsed.data),
        clientId: client.clientId,
      },
      { ignoreLimit: staff.platform },
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === "EVENT_LIMIT") return { error: error.message };
    throw error;
  }
  await audit(staff.id, "event.create", "Event", event.id);
  // Sigue el asistente: lugar y fecha, entradas, revisar y publicar (se puede salir en cualquier paso).
  redirect(`/eventos/${event.id}/asistente/lugar`);
}

export async function updateEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const event = await ownedEvent(staff.organization.id, String(formData.get("eventId")));
  if (!event) return { error: "Evento no encontrado." };
  const parsed = eventSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  if (!allowedCategories(staff).includes(parsed.data.category)) return { fieldErrors: { category: "Categoría no disponible para este organizador." } };
  const client = await checkClient(staff.organization.id, parsed.data.clientId);
  if (!client.ok) return { fieldErrors: { clientId: "Cliente no encontrado." } };
  if (parsed.data.mode !== event.mode) {
    // Cambiar de venta a invitados (o al revés) con entradas emitidas mezclaría los dos flujos.
    const issued = await prisma.ticket.count({ where: { session: { eventId: event.id }, status: { in: ["VALID", "USED"] } } });
    if (issued > 0) {
      return { fieldErrors: { mode: `No se puede cambiar la modalidad: el evento ya tiene ${issued} entrada(s) emitida(s).` } };
    }
  }

  await prisma.event.update({
    where: { id: event.id },
    data: {
      ...eventData(parsed.data),
      clientId: client.clientId,
      // Sin cliente no hay espacio de cliente que mantener abierto.
      ...(client.clientId ? {} : { clientAccessEnabled: false, clientAccessUntil: null }),
    },
  });
  await audit(staff.id, "event.update", "Event", event.id);
  revalidatePath(`/eventos/${event.id}`);
  return { ok: true };
}

/**
 * Publicar. IMPACTA publica directo (también cuando entró en un organizador). Un
 * organizador no publica: lo envía a revisión y sale en la web cuando IMPACTA lo aprueba.
 */
export async function publishEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const event = await ownedEvent(staff.organization.id, String(formData.get("eventId")));
  if (!event) return { error: "Evento no encontrado." };

  if (!staff.platform) {
    try {
      await submitEventForReview(event.id, staff.id);
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }
    revalidatePath(`/eventos/${event.id}`, "layout");
    return { ok: true };
  }

  const problem = await publicationProblem(event.id);
  if (problem) return { error: problem };
  await prisma.event.update({
    where: { id: event.id },
    data: { status: "PUBLISHED", publishedAt: new Date(), reviewNote: null },
  });
  await audit(staff.id, "event.publish", "Event", event.id);
  revalidatePath(`/eventos/${event.id}`, "layout");
  return { ok: true };
}

/** Pasar a borrador: deja de venderse (o sale de la revisión, si estaba esperando). */
export async function unpublishEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const event = await ownedEvent(staff.organization.id, String(formData.get("eventId")));
  if (!event) return { error: "Evento no encontrado." };
  await prisma.event.update({ where: { id: event.id }, data: { status: "DRAFT" } });
  await audit(staff.id, "event.unpublish", "Event", event.id);
  revalidatePath(`/eventos/${event.id}`, "layout");
  return { ok: true };
}

/** Horarios y venta online de una función, tal como vienen del formulario (ver SessionTimesFields). */
function readSessionForm(form: Record<string, string | undefined>, timeZone: string) {
  const times = parseSessionTimes(
    { date: form.date, start: form.start, doors: form.doors, arrival: form.arrival, end: form.end, lastEntry: form.lastEntry },
    timeZone,
  );
  if (!times.ok) return { ok: false as const, state: { fieldErrors: { [times.field]: times.message } } satisfies FormState };
  const sales = parseSalesWindow(
    { open: form.open, openAt: form.openAt, close: form.close, closeHours: form.closeHours, closeAt: form.closeAt },
    times.times,
    timeZone,
  );
  if (!sales.ok) return { ok: false as const, state: { fieldErrors: { [sales.field]: sales.message } } satisfies FormState };
  return { ok: true as const, data: { ...times.times, ...sales.window } };
}

export async function createSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const form = formObject(formData);
  // Asistente: en vez de elegir un recinto se puede escribir un lugar simple (una zona general con su aforo).
  const newVenue = form.newVenueName?.slice(0, 120);
  const newCapacity = Number(form.newVenueCapacity);
  if (newVenue && (!Number.isInteger(newCapacity) || newCapacity < 1 || newCapacity > 200_000)) {
    return { fieldErrors: { newVenueCapacity: "Indica cuántas personas entran en el lugar (aforo)." } };
  }
  if (!newVenue && !form.venueId) return { fieldErrors: { venueId: "Elige un recinto o escribe un lugar nuevo." } };

  const [event, existing] = await Promise.all([
    ownedEvent(staff.organization.id, String(form.eventId)),
    newVenue ? null : prisma.venue.findFirst({ where: { id: form.venueId, organizationId: staff.organization.id } }),
  ]);
  if (!event || (!newVenue && !existing)) return { error: "Evento o recinto no encontrado." };

  // La hora que escribe el organizador es la del recinto, no la del servidor.
  const timeZone = existing?.timezone ?? DEFAULT_TIMEZONE;
  const parsed = readSessionForm(form, timeZone);
  if (!parsed.ok) return parsed.state;
  const noun = sessionNoun(event.category);
  if (parsed.data.startsAt <= new Date()) return { fieldErrors: { date: `${noun.The} debe ser en el futuro.` } };

  let venueId = existing?.id;
  if (newVenue) {
    if (await prisma.venue.findFirst({ where: { organizationId: staff.organization.id, name: newVenue } })) {
      return { fieldErrors: { newVenueName: `Ya tienes un recinto "${newVenue}": elígelo en la lista.` } };
    }
    const venue = await prisma.venue.create({
      data: {
        organizationId: staff.organization.id,
        name: newVenue,
        address: form.newVenueAddress?.slice(0, 200) || null,
        city: form.newVenueCity?.slice(0, 80) || null,
        timezone: timeZone,
        accessPoints: { create: [{ name: "Puerta principal" }] },
        sections: { create: [{ name: "General", seatingMode: "GENERAL_ADMISSION", capacity: newCapacity }] },
      },
    });
    await audit(staff.id, "venue.create", "Venue", venue.id);
    venueId = venue.id;
  }

  const session = await prisma.eventSession.create({ data: { eventId: event.id, venueId: venueId!, ...parsed.data } });
  await audit(staff.id, "session.create", "EventSession", session.id);
  revalidatePath(`/eventos/${event.id}`);
  if (form.next === "asistente") redirect(`/eventos/${event.id}/asistente/entradas`);
  return { ok: true, message: `${noun.One} agregada: cárgale los precios.` };
}

/**
 * Cambia los horarios y la venta online de una función. Si cambia el inicio, las entradas con horario de
 * ingreso ("free hasta la 01:00") conservan su hora del reloj, ahora en el día nuevo.
 */
export async function updateSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const form = formObject(formData);
  const session = await prisma.eventSession.findFirst({
    where: { id: String(form.sessionId), event: { organizationId: staff.organization.id } },
    include: { venue: { select: { timezone: true } }, event: { select: { category: true } }, ticketTypes: { where: { entryUntil: { not: null } } } },
  });
  if (!session || session.cancelledAt) return { error: "Función no encontrada." };
  const tz = session.venue.timezone;
  const parsed = readSessionForm(form, tz);
  if (!parsed.ok) return parsed.state;
  const moved = parsed.data.startsAt.getTime() !== session.startsAt.getTime();
  if (moved && parsed.data.startsAt <= new Date()) return { fieldErrors: { date: "La nueva fecha ya pasó: elige una que venga." } };

  await prisma.$transaction(async (tx) => {
    await tx.eventSession.update({ where: { id: session.id }, data: parsed.data });
    if (moved) {
      for (const t of session.ticketTypes) {
        const clock = utcToZonedInput(t.entryUntil!, tz).slice(11, 16);
        await tx.ticketType.update({ where: { id: t.id }, data: { entryUntil: entryDeadline(parsed.data.startsAt, clock, tz) } });
      }
    }
  });
  await audit(staff.id, "session.update", "EventSession", session.id, {
    from: { startsAt: session.startsAt, endsAt: session.endsAt, doorsOpenAt: session.doorsOpenAt, salesEndAt: session.salesEndAt },
    to: parsed.data,
  });
  revalidatePath(`/eventos/${session.eventId}`);
  revalidatePath(`/eventos/${session.eventId}/funciones/${session.id}`);
  return { ok: true, message: "Horarios guardados." };
}

/** Programa de la función (quién toca y a qué hora). Vacío = sin programa. */
export async function updateProgramAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const session = await prisma.eventSession.findFirst({
    where: { id: String(formData.get("sessionId")), event: { organizationId: staff.organization.id } },
  });
  if (!session) return { error: "Función no encontrada." };
  let json: unknown = [];
  try {
    json = JSON.parse(String(formData.get("program") ?? "[]"));
  } catch {
    return { error: "El programa no es válido." };
  }
  const program = parseProgram(json);
  await prisma.eventSession.update({ where: { id: session.id }, data: { program: program.length ? program : Prisma.DbNull } });
  await audit(staff.id, "session.program", "EventSession", session.id, { items: program.length });
  revalidatePath(`/eventos/${session.eventId}/funciones/${session.id}`);
  return { ok: true, message: program.length ? `Programa guardado (${program.length}).` : "Programa vacío: no se muestra." };
}

/** "Nueva noche" / "Duplicar función": copia una función con sus precios a otro día y abre la copia. */
export async function duplicateSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const template = await prisma.eventSession.findFirst({
    where: { id: String(formData.get("sessionId")), event: { organizationId: staff.organization.id } },
  });
  if (!template) return { fieldErrors: { sessionId: "Elige qué copiar." } };
  let copy;
  try {
    copy = await duplicateSession({ templateSessionId: template.id, date: String(formData.get("date") ?? ""), staffId: staff.id });
  } catch (error) {
    if (error instanceof DomainError) return { fieldErrors: { date: error.message } };
    throw error;
  }
  revalidatePath(`/eventos/${template.eventId}`);
  redirect(`/eventos/${template.eventId}/funciones/${copy.id}`);
}

/** Solo se puede borrar una función sin ventas; con ventas habría que cancelarla y reembolsar. */
export async function deleteSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
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
  presale: z.literal("on").optional(),
  salesStartAt: z.string().optional(),
  salesEndAt: z.string().optional(),
  /** Preventa: mientras dure, las otras entradas de la sección no se venden. */
  exclusive: z.literal("on").optional(),
  /** QR dinámico: cambia cada 30 s, solo QR y solo venta online. */
  qrDynamic: z.literal("on").optional(),
  /** Reingreso: "yes" = sale y vuelve con el mismo QR las veces que quiera; "no" (o vacío) = un solo ingreso. */
  reentry: z.enum(["yes", "no"]).optional(),
  /** Descuento de preventa sobre el mismo tipo de entrada. */
  discountPercent: z.string().optional(),
  discountStartsAt: z.string().optional(),
  discountEndsAt: z.string().optional(),
  /** Boliche: mesa o lounge para varias personas (el cupo se cuenta en mesas). */
  table: z.literal("on").optional(),
  peoplePerUnit: intField(2, 50, "Las personas por mesa").optional(),
  /** Consumo incluido en barra (Bs), por mesa o por entrada. */
  consumption: moneyField.optional(),
  /** Válida para entrar hasta esta hora (HH:MM, hora del recinto). */
  entryUntil: z.string().refine(isTimeOfDay, "Hora inválida (ej. 01:00).").optional(),
});

const ACCESS_METHODS = ["QR", "BARCODE", "NFC"] as const;

/** Métodos de lectura marcados en el formulario; si no marca ninguno, solo QR. */
function readAccessMethods(formData: FormData) {
  const picked = formData.getAll("methods").filter((m): m is (typeof ACCESS_METHODS)[number] =>
    ACCESS_METHODS.includes(m as (typeof ACCESS_METHODS)[number]),
  );
  return picked.length > 0 ? [...new Set(picked)] : (["QR"] as const);
}

type Window = { salesStartAt: Date | null; salesEndAt: Date | null };

/** Fechas de venta escritas en la hora del recinto, validadas. */
function parseSaleWindow(
  input: { presale?: string; salesStartAt?: string; salesEndAt?: string },
  timeZone: string,
): { ok: true; window: Window } | { ok: false; error: FormState } {
  const toDate = (value: string | undefined) => (value ? zonedDateTimeToUtc(value, timeZone) : null);
  let window: Window;
  try {
    window = { salesStartAt: toDate(input.salesStartAt), salesEndAt: toDate(input.salesEndAt) };
  } catch {
    return { ok: false, error: { fieldErrors: { salesEndAt: "Fecha inválida." } } };
  }
  if (input.presale && !window.salesEndAt) {
    return { ok: false, error: { fieldErrors: { salesEndAt: "La preventa necesita fecha de fin (hasta cuándo se vende)." } } };
  }
  if (window.salesStartAt && window.salesEndAt && window.salesEndAt <= window.salesStartAt) {
    return { ok: false, error: { fieldErrors: { salesEndAt: "La venta tiene que terminar después de empezar." } } };
  }
  return { ok: true, window };
}

type Discount = { discountPercent: number | null; discountStartsAt: Date | null; discountEndsAt: Date | null };
const NO_DISCOUNT: Discount = { discountPercent: null, discountStartsAt: null, discountEndsAt: null };

/** Descuento de preventa escrito en la hora del recinto: porcentaje, desde (opcional) y hasta (obligatorio). */
function parseDiscount(
  input: { discountPercent?: string; discountStartsAt?: string; discountEndsAt?: string },
  timeZone: string,
): { ok: true; discount: Discount } | { ok: false; error: FormState } {
  const raw = input.discountPercent?.trim();
  if (!raw) return { ok: true, discount: NO_DISCOUNT };
  const percent = Number(raw.replace(",", "."));
  if (!Number.isInteger(percent) || percent < 1 || percent > MAX_DISCOUNT_PERCENT) {
    return { ok: false, error: { fieldErrors: { discountPercent: `El descuento debe ser un porcentaje entero de 1 a ${MAX_DISCOUNT_PERCENT}.` } } };
  }
  if (!input.discountEndsAt) {
    return { ok: false, error: { fieldErrors: { discountEndsAt: "Indica hasta cuándo dura el descuento de preventa." } } };
  }
  let startsAt: Date | null;
  let endsAt: Date;
  try {
    startsAt = input.discountStartsAt ? zonedDateTimeToUtc(input.discountStartsAt, timeZone) : null;
    endsAt = zonedDateTimeToUtc(input.discountEndsAt, timeZone);
  } catch {
    return { ok: false, error: { fieldErrors: { discountEndsAt: "Fecha inválida." } } };
  }
  if (startsAt && endsAt <= startsAt) {
    return { ok: false, error: { fieldErrors: { discountEndsAt: "El descuento tiene que terminar después de empezar." } } };
  }
  return { ok: true, discount: { discountPercent: percent, discountStartsAt: startsAt, discountEndsAt: endsAt } };
}

const seatedOverlapError = (sectionName: string) =>
  `"${sectionName}" es de butacas numeradas: solo puede tener un precio a la vez. Pon fecha de fin a la preventa y la general empieza cuando termina (casilla "no vender las otras").`;

export async function addTicketTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const parsed = ticketTypeSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const data = parsed.data;

  const session = await prisma.eventSession.findFirst({
    where: { id: data.sessionId, event: { organizationId: staff.organization.id } },
    include: { venue: { select: { timezone: true } }, event: { select: { mode: true } } },
  });
  const section = await prisma.section.findFirst({
    where: { id: data.sectionId, venueId: session?.venueId },
    include: { _count: { select: { seats: true } } },
  });
  if (!session || !section) return { error: "Función o sección no encontrada." };

  // Boliche: mesa para N personas, consumo incluido y horario de ingreso.
  const table = Boolean(data.table);
  const peoplePerUnit = table ? data.peoplePerUnit : 1;
  if (table && !peoplePerUnit) return { fieldErrors: { peoplePerUnit: "Indica cuántas personas entran con cada mesa." } };
  if (table && isSeatedTablesLayout(section.layout)) {
    return { fieldErrors: { table: `"${section.name}" son mesas con sillas: cada silla es una entrada (no marques "Es una mesa o lounge"). El precio es por silla.` } };
  }
  if (!table && isTablesLayout(section.layout)) {
    return { fieldErrors: { table: `"${section.name}" son lounges: marca "Es una mesa o lounge" y cuántas personas entran en cada uno.` } };
  }
  const entryUntil = data.entryUntil ? entryDeadline(session.startsAt, data.entryUntil, session.venue.timezone) : null;
  const qrMode = data.qrDynamic ? ("DYNAMIC" as const) : ("STATIC" as const);
  if (qrMode === "DYNAMIC" && session.event.mode !== "TICKETING") {
    return { error: "El QR dinámico es para eventos con venta de entradas, no para listas de invitados." };
  }

  const parsedWindow = parseSaleWindow(data, session.venue.timezone);
  if (!parsedWindow.ok) return parsedWindow.error;
  const window = parsedWindow.window;
  const parsedDiscount = parseDiscount(data, session.venue.timezone);
  if (!parsedDiscount.ok) return parsedDiscount.error;
  const presale = Boolean(data.presale);
  if (presale && window.salesEndAt && window.salesEndAt <= new Date()) {
    return { fieldErrors: { salesEndAt: "La fecha de fin de la preventa ya pasó." } };
  }

  const seated = section.seatingMode === "RESERVED";
  let capacity: number;
  if (seated) {
    capacity = section._count.seats; // cada butaca es una entrada
  } else {
    if (!data.capacity) return { fieldErrors: { capacity: table ? "Ingresa cuántas mesas hay." : "Ingresa el cupo." } };
    if (data.capacity * (peoplePerUnit ?? 1) > section.capacity) {
      return {
        fieldErrors: {
          capacity: table
            ? `${data.capacity} mesas de ${peoplePerUnit} son ${data.capacity * peoplePerUnit!} personas y "${section.name}" admite ${section.capacity}.`
            : `"${section.name}" admite como máximo ${section.capacity} personas.`,
        },
      };
    }
    capacity = data.capacity;
  }

  // Preventa exclusiva: las otras entradas de la sección empiezan cuando termina la preventa.
  // En butacas numeradas es obligatoria: cada butaca tiene un solo precio a la vez.
  const others = await prisma.ticketType.findMany({ where: { sessionId: session.id, sectionId: section.id } });
  const shift = presale && (seated || Boolean(data.exclusive)) && window.salesEndAt ? window.salesEndAt : null;
  const adjusted = others.map((t) => {
    if (!shift || !windowsOverlap(window, t)) return { type: t, window: t as Window, changed: false };
    const start = t.salesStartAt && t.salesStartAt > shift ? t.salesStartAt : shift;
    return { type: t, window: { salesStartAt: start, salesEndAt: t.salesEndAt }, changed: true };
  });
  if (adjusted.some((a) => a.window.salesEndAt && a.window.salesStartAt && a.window.salesEndAt <= a.window.salesStartAt)) {
    return { error: "Otra entrada de esta sección termina antes de que termine la preventa: revisa sus fechas." };
  }
  if (seated && adjusted.some((a) => windowsOverlap(window, a.window))) {
    return { error: seatedOverlapError(section.name) };
  }

  const type = await prisma.$transaction(async (tx) => {
    for (const a of adjusted.filter((x) => x.changed)) {
      await tx.ticketType.update({ where: { id: a.type.id }, data: { salesStartAt: a.window.salesStartAt } });
    }
    return tx.ticketType.create({
      data: {
        sessionId: session.id,
        sectionId: section.id,
        name: data.name,
        unitAmount: data.price,
        currency: staff.organization.currency,
        capacity,
        // Gratis (lista free): una por persona; createPendingOrder también lo exige.
        maxPerOrder: data.price === 0 ? 1 : data.maxPerOrder,
        presale,
        ...parsedDiscount.discount,
        kind: table ? ("TABLE" as const) : ("ENTRY" as const),
        peoplePerUnit: peoplePerUnit ?? 1,
        consumptionAmount: data.consumption || null,
        entryUntil,
        // El QR dinámico solo se lee con QR: el código de barras y el NFC son fijos.
        accessMethods: qrMode === "DYNAMIC" ? ["QR" as const] : [...readAccessMethods(formData)],
        qrMode,
        maxEntries: data.reentry === "yes" ? 0 : 1,
        salesStartAt: window.salesStartAt,
        salesEndAt: window.salesEndAt,
        sortOrder: await tx.ticketType.count({ where: { sessionId: session.id } }),
      },
    });
  });
  await audit(staff.id, "ticket_type.create", "TicketType", type.id, {
    price: data.price,
    capacity,
    presale,
    ...(table ? { table: true, peoplePerUnit } : {}),
    ...(data.consumption ? { consumption: data.consumption } : {}),
    ...(entryUntil ? { entryUntil: entryUntil.toISOString() } : {}),
    shifted: adjusted.filter((a) => a.changed).map((a) => a.type.id),
  });
  revalidatePath(`/eventos/${session.eventId}/funciones/${session.id}`);
  revalidatePath(`/eventos/${session.eventId}/asistente/entradas`);
  return { ok: true };
}

/** Cambia cómo se lee una entrada en puerta (QR, código de barras, NFC). Vale también para las ya vendidas. */
export async function updateAccessMethodsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const type = await prisma.ticketType.findFirst({
    where: { id: String(formData.get("ticketTypeId")), session: { event: { organizationId: staff.organization.id } } },
    include: { session: true },
  });
  if (!type) return { error: "Tipo de entrada no encontrado." };
  if (type.qrMode === "DYNAMIC") return { error: "Una entrada de QR dinámico se lee solo con QR." };
  const methods = [...readAccessMethods(formData)];
  await prisma.ticketType.update({ where: { id: type.id }, data: { accessMethods: methods } });
  await audit(staff.id, "ticket_type.access_methods", "TicketType", type.id, { methods });
  revalidatePath(`/eventos/${type.session.eventId}/funciones/${type.sessionId}`);
  return { ok: true };
}

/**
 * Reglas de acceso de un tipo de entrada: cuántas veces puede entrar (1 = sin reingreso; 0 = sin límite) y qué zonas
 * del recinto abre (ninguna marcada = las de siempre, según las secciones de cada puerta). Valen también para las ya vendidas.
 */
export async function updateEntryRulesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const type = await prisma.ticketType.findFirst({
    where: { id: String(formData.get("ticketTypeId")), session: { event: { organizationId: staff.organization.id } } },
    include: { session: true },
  });
  if (!type) return { error: "Tipo de entrada no encontrado." };
  const maxEntries = Number(formData.get("maxEntries"));
  if (!Number.isInteger(maxEntries) || maxEntries < 0 || maxEntries > 20) return { fieldErrors: { maxEntries: "Ingresos permitidos: de 1 a 20, o sin límite." } };
  const requested = formData.getAll("zoneIds").map(String);
  const zones = await prisma.accessZone.findMany({ where: { id: { in: requested }, venueId: type.session.venueId }, select: { id: true } });
  await prisma.ticketType.update({ where: { id: type.id }, data: { maxEntries, zones: { set: zones } } });
  await audit(staff.id, "ticket_type.entry_rules", "TicketType", type.id, { maxEntries, zones: zones.map((z) => z.id) });
  revalidatePath(`/eventos/${type.session.eventId}/funciones/${type.sessionId}`);
  return { ok: true };
}

/** Activa o desactiva el QR dinámico de un tipo de entrada (solo mientras no tenga ventas). */
export async function setQrModeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const mode = formData.get("mode") === "DYNAMIC" ? "DYNAMIC" : "STATIC";
  const typeId = String(formData.get("ticketTypeId"));
  const result = await setTicketTypeQrMode(typeId, staff.organization.id, mode);
  if (!result.ok) {
    return {
      error: {
        NOT_FOUND: "Tipo de entrada no encontrado.",
        HAS_SALES: "Ya hay ventas de este tipo de entrada: el modo del QR no se puede cambiar.",
        GUEST_LIST: "El QR dinámico es para eventos con venta de entradas, no para listas de invitados.",
      }[result.reason],
    };
  }
  const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: typeId }, include: { session: true } });
  if (result.changed) await audit(staff.id, "ticket_type.qr_mode", "TicketType", typeId, { mode });
  revalidatePath(`/eventos/${type.session.eventId}/funciones/${type.sessionId}`);
  return { ok: true };
}

const saleDatesSchema = z.object({
  ticketTypeId: z.string(),
  discountPercent: z.string().optional(),
  discountStartsAt: z.string().optional(),
  discountEndsAt: z.string().optional(),
  presale: z.literal("on").optional(),
  salesStartAt: z.string().optional(),
  salesEndAt: z.string().optional(),
});

/** Cambiar desde/hasta cuándo se vende un tipo (extender o cortar una preventa). */
export async function updateTicketTypeSalesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const parsed = saleDatesSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const type = await prisma.ticketType.findFirst({
    where: { id: parsed.data.ticketTypeId, session: { event: { organizationId: staff.organization.id } } },
    include: { section: true, session: { include: { venue: { select: { timezone: true } } } } },
  });
  if (!type) return { error: "Tipo de entrada no encontrado." };

  const parsedWindow = parseSaleWindow(parsed.data, type.session.venue.timezone);
  if (!parsedWindow.ok) return parsedWindow.error;
  const window = parsedWindow.window;
  const parsedDiscount = parseDiscount(parsed.data, type.session.venue.timezone);
  if (!parsedDiscount.ok) return parsedDiscount.error;
  if (type.section?.seatingMode === "RESERVED") {
    const others = await prisma.ticketType.findMany({
      where: { sessionId: type.sessionId, sectionId: type.sectionId, id: { not: type.id } },
    });
    if (others.some((t) => windowsOverlap(window, t))) return { error: seatedOverlapError(type.section.name) };
  }

  await prisma.ticketType.update({
    where: { id: type.id },
    data: {
      presale: Boolean(parsed.data.presale),
      salesStartAt: window.salesStartAt,
      salesEndAt: window.salesEndAt,
      ...parsedDiscount.discount,
    },
  });
  await audit(staff.id, "ticket_type.sales", "TicketType", type.id, {
    presale: Boolean(parsed.data.presale),
    salesStartAt: window.salesStartAt?.toISOString() ?? null,
    salesEndAt: window.salesEndAt?.toISOString() ?? null,
    discountPercent: parsedDiscount.discount.discountPercent,
    discountEndsAt: parsedDiscount.discount.discountEndsAt?.toISOString() ?? null,
  });
  revalidatePath(`/eventos/${type.session.eventId}/funciones/${type.sessionId}`);
  return { ok: true };
}

export async function deleteTicketTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
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
  const staff = await requireEditor();
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
