"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DEFAULT_TIMEZONE, MAX_PRINT_BATCH, PRINT_SALE_METHODS, parseSerialRange, parseSessionTimes, slugify, type PrintSaleMethod } from "@ticketera/core";
import {
  DomainError,
  createEventWithinLimit,
  createPrintBatch,
  movePrintedTickets,
  prisma,
  settlePrintedSeller,
  type EventCategory,
  type PrintAction,
} from "@ticketera/db";
import { formObject, moneyField, type FormState } from "@/lib/forms";
import { allowedCategories, requireEditor, type Staff } from "@/lib/session";
import { logAudit } from "@/lib/audit";

/** Función de la organización (con su evento) o null. */
async function ownSession(staff: Staff, sessionId: string) {
  return prisma.eventSession.findFirst({ where: { id: sessionId, event: { organizationId: staff.organization.id } } });
}

async function ownBatch(staff: Staff, batchId: string) {
  return prisma.printBatch.findFirst({ where: { id: batchId, session: { event: { organizationId: staff.organization.id } } }, include: { session: true } });
}

const batchPath = (batch: { id: string; session: { id: string; eventId: string } }) => `/eventos/${batch.session.eventId}/funciones/${batch.session.id}/impresas/${batch.id}`;

/** Nuevo lote de entradas impresas: descuenta cupo y abre el lote para imprimirlo. */
export async function createPrintBatchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const form = formObject(formData);
  const session = await ownSession(staff, String(form.sessionId));
  if (!session) return { error: "Función no encontrada." };
  const quantity = Number(form.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PRINT_BATCH) {
    return { fieldErrors: { quantity: `La cantidad va de 1 a ${MAX_PRINT_BATCH}.` } };
  }
  let unitAmount: number | undefined;
  if (form.price) {
    const price = moneyField.safeParse(form.price);
    if (!price.success) return { fieldErrors: { price: "Precio inválido (ej. 60 o 60,50)." } };
    unitAmount = price.data;
  }
  let batch;
  try {
    batch = await createPrintBatch({
      sessionId: session.id,
      ticketTypeId: String(form.ticketTypeId),
      quantity,
      prefix: form.prefix,
      mode: form.mode === "VALID_ON_PRINT" ? "VALID_ON_PRINT" : "ACTIVATE_ON_SALE",
      unitAmount,
      note: form.note,
      artId: form.artId || null,
      staffId: staff.id,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/eventos/${session.eventId}/funciones/${session.id}`);
  redirect(`/eventos/${session.eventId}/funciones/${session.id}/impresas/${batch.id}`);
}

const ACTION_DONE: Record<PrintAction["type"], string> = {
  ASSIGN: "entregada(s)",
  SELL: "vendida(s)",
  RETURN: "devuelta(s)",
  STOCK: "de vuelta en stock",
  VOID: "anulada(s)",
};

/**
 * Entregar, vender, devolver, volver a stock o anular entradas de un lote, por rango de serie o por código (escrito
 * o leído con el escáner, uno por línea).
 */
export async function movePrintedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const form = formObject(formData);
  const batch = await ownBatch(staff, String(form.batchId));
  if (!batch) return { error: "Lote no encontrado." };

  const type = form.action as PrintAction["type"];
  let action: PrintAction;
  if (type === "ASSIGN") {
    if (!form.seller) return { fieldErrors: { seller: "Escribe a quién se entregan." } };
    action = { type, seller: form.seller };
  } else if (type === "SELL") {
    const method = (PRINT_SALE_METHODS as readonly string[]).includes(form.method ?? "") ? (form.method as PrintSaleMethod) : null;
    if (!method) return { fieldErrors: { method: "Elige cómo pagaron." } };
    let amount: number | undefined;
    if (form.price) {
      const price = moneyField.safeParse(form.price);
      if (!price.success) return { fieldErrors: { price: "Precio inválido (ej. 60 o 60,50)." } };
      amount = price.data;
    }
    action = { type, method, amount };
  } else if (type === "RETURN" || type === "STOCK" || type === "VOID") {
    action = { type };
  } else {
    return { error: "Acción desconocida." };
  }

  const codes = (form.codes ?? "")
    .split(/\r?\n|,/)
    .map((c) => c.trim())
    .filter(Boolean);
  let range: { from: number; to: number } | undefined;
  if (codes.length === 0) {
    const parsed = parseSerialRange(form.range ?? "");
    if (!parsed.ok) return { fieldErrors: { range: parsed.error } };
    range = { from: parsed.from, to: parsed.to };
  }

  let result;
  try {
    result = await movePrintedTickets({ batchId: batch.id, range, codes: codes.length ? codes : undefined, action, staffId: staff.id });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(batchPath(batch));
  const skipped = result.skipped.length
    ? ` No se cambiaron ${result.skipped.length}: ${result.skipped
        .slice(0, 6)
        .map((s) => `${s.serial} (${s.reason})`)
        .join(", ")}${result.skipped.length > 6 ? "…" : ""}.`
    : "";
  const outside = result.notInBatch > 0 ? ` ${result.notInBatch} código(s) no son de este lote.` : "";
  return { ok: true, message: `${result.moved} entrada(s) ${ACTION_DONE[type]}.${skipped}${outside}` };
}

/** Rendición de un vendedor: lo que entrega contra lo que vendió. */
export async function settleSellerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const form = formObject(formData);
  const batch = await ownBatch(staff, String(form.batchId));
  if (!batch) return { error: "Lote no encontrado." };
  const received = moneyField.safeParse(form.received ?? "");
  if (!received.success) return { fieldErrors: { received: "Escribe cuánto entregó (ej. 600)." } };
  let result;
  try {
    result = await settlePrintedSeller({ batchId: batch.id, seller: form.seller ?? "", receivedAmount: received.data, note: form.note, staffId: staff.id });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(batchPath(batch));
  const diff = result.difference;
  return {
    ok: true,
    message:
      diff === 0
        ? "Rendición registrada: cuadra justo."
        : diff > 0
          ? `Rendición registrada: entregó Bs ${(diff / 100).toFixed(2).replace(".", ",")} de más.`
          : `Rendición registrada: faltan Bs ${(-diff / 100).toFixed(2).replace(".", ",")}.`,
  };
}

const ART_TYPES = ["image/png", "image/jpeg"];
const MAX_ART_BYTES = 3_000_000;

/** Sube el arte de la entrada (PNG o JPG): se dibuja de fondo y encima van el QR, la serie y los datos. */
export async function uploadTicketArtAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const file = formData.get("art");
  const name = String(formData.get("name") ?? "").trim() || "Diseño";
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { art: "Elige una imagen PNG o JPG." } };
  if (!ART_TYPES.includes(file.type)) return { fieldErrors: { art: "Solo PNG o JPG." } };
  if (file.size > MAX_ART_BYTES) return { fieldErrors: { art: "La imagen supera 3 MB: expórtala más liviana." } };
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Firma del archivo: que de verdad sea un PNG o un JPG (no solo la extensión).
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!(isPng || isJpg)) return { fieldErrors: { art: "El archivo no es una imagen PNG o JPG válida." } };
  const art = await prisma.ticketArt.create({
    data: { organizationId: staff.organization.id, name: name.slice(0, 60), mimeType: isPng ? "image/png" : "image/jpeg", data: bytes },
  });
  await logAudit({ actorType: "staff", actorId: staff.id, action: "print.art.upload", entity: "TicketArt", entityId: art.id });
  const back = String(formData.get("back") ?? "");
  if (back.startsWith("/")) revalidatePath(back);
  return { ok: true, message: `Diseño "${art.name}" guardado: elígelo al crear un lote.` };
}

const MAX_SMALL_TYPES = 4;

/**
 * "Evento pequeño": en un solo paso crea el lugar (sin mapa: una zona general con el aforo de las entradas), el evento
 * en borrador, su función, los precios y un lote de entradas impresas por tipo. Después solo queda imprimir.
 */
export async function createSmallEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const form = formObject(formData);
  const title = form.title?.trim() ?? "";
  if (title.length < 3) return { fieldErrors: { title: "Escribe el nombre del evento." } };
  const place = form.place?.trim() ?? "";
  if (place.length < 2) return { fieldErrors: { place: "Escribe el lugar." } };

  // Cada fila conserva su número para marcar el campo con error.
  const rows = Array.from({ length: MAX_SMALL_TYPES }, (_, i) => ({
    i,
    name: form[`name${i}`]?.trim() ?? "",
    price: form[`price${i}`]?.trim() ?? "",
    quantity: Number(form[`quantity${i}`]),
  })).filter((r) => r.name || r.price || r.quantity);
  if (rows.length === 0) return { fieldErrors: { name0: "Agrega al menos un tipo de entrada con cantidad y precio." } };
  const types: { name: string; unitAmount: number; quantity: number }[] = [];
  for (const { i, ...r } of rows) {
    if (r.name.length < 2) return { fieldErrors: { [`name${i}`]: "Cada tipo necesita un nombre (ej. General)." } };
    if (!Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > MAX_PRINT_BATCH) {
      return { fieldErrors: { [`quantity${i}`]: `Cantidad de "${r.name}": de 1 a ${MAX_PRINT_BATCH}.` } };
    }
    const price = moneyField.safeParse(r.price);
    if (!price.success) return { fieldErrors: { [`price${i}`]: `Precio de "${r.name}" inválido (ej. 50 o 0 si es gratis).` } };
    types.push({ name: r.name, unitAmount: price.data, quantity: r.quantity });
  }

  const timeZone = DEFAULT_TIMEZONE;
  const times = parseSessionTimes({ date: form.date, start: form.start, doors: form.doors, end: form.end }, timeZone);
  if (!times.ok) return { fieldErrors: { [times.field]: times.message } };
  if (times.times.startsAt <= new Date()) return { fieldErrors: { date: "El evento debe ser en el futuro." } };
  const categories = allowedCategories(staff).filter((c) => c !== "BOLICHE");
  if (!(categories as string[]).includes(form.category ?? "")) return { fieldErrors: { category: "Elige una categoría." } };
  const category = form.category as EventCategory;

  let event;
  try {
    event = await createEventWithinLimit(
      { organizationId: staff.organization.id, slug: await uniqueEventSlug(title), title, category, mode: "TICKETING", small: true, description: form.description?.trim() || null },
      { ignoreLimit: staff.platform },
    );
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  const total = types.reduce((sum, t) => sum + t.quantity, 0);
  const venue = await prisma.venue.create({
    data: {
      organizationId: staff.organization.id,
      name: place.slice(0, 120),
      address: form.address?.trim() || null,
      city: form.city?.trim() || null,
      timezone: timeZone,
      accessPoints: { create: [{ name: "Puerta principal" }] },
      sections: { create: [{ name: "General", seatingMode: "GENERAL_ADMISSION", capacity: total }] },
    },
    include: { sections: true },
  });
  const session = await prisma.eventSession.create({ data: { eventId: event.id, venueId: venue.id, ...times.times } });
  const mode = form.mode === "VALID_ON_PRINT" ? "VALID_ON_PRINT" : "ACTIVATE_ON_SALE";
  for (const [i, t] of types.entries()) {
    const type = await prisma.ticketType.create({
      data: {
        sessionId: session.id,
        sectionId: venue.sections[0]!.id,
        name: t.name,
        unitAmount: t.unitAmount,
        currency: staff.organization.currency,
        capacity: t.quantity,
        maxPerOrder: t.unitAmount === 0 ? 1 : 10,
        sortOrder: i,
      },
    });
    await createPrintBatch({ sessionId: session.id, ticketTypeId: type.id, quantity: t.quantity, mode, staffId: staff.id });
  }
  await logAudit({ actorType: "staff", actorId: staff.id, action: "event.small.create", entity: "Event", entityId: event.id, data: { types: types.length, total } });
  revalidatePath("/eventos");
  redirect(`/eventos/${event.id}/funciones/${session.id}?tab=impresas`);
}

async function uniqueEventSlug(title: string) {
  const base = slugify(title) || "evento";
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await prisma.event.findUnique({ where: { slug } }))) return slug;
  }
}
