"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseGuestList } from "@ticketera/core";
import { DomainError, cancelGuestTicket, issueGuestTickets, prisma } from "@ticketera/db";
import { formObject, intField, zodErrors, type FormState } from "@/lib/forms";
import { ROLES, can, requireStaff, visibleEvent, type Staff } from "@/lib/session";
import { logAudit } from "@/lib/audit";

/** IMPACTA en cualquier evento; el cliente solo en sus eventos con lista de invitados y con su espacio abierto. */
async function guestEvent(staff: Staff, eventId: string) {
  const event = await visibleEvent(staff, eventId);
  if (!event) return null;
  if (!can(staff, ROLES.manage) && event.mode !== "GUEST_LIST") return null;
  return event;
}

function revalidateGuests(eventId: string, sessionId: string) {
  revalidatePath(`/eventos/${eventId}/funciones/${sessionId}/invitados`);
  revalidatePath(`/cliente/${eventId}/invitados/${sessionId}`);
}

const guestTypeSchema = z.object({
  sessionId: z.string(),
  name: z.string().min(2, "Ingresa un nombre.").max(60).default("Invitado"),
  sectionId: z.string().optional(),
  capacity: intField(1, 100_000, "El cupo"),
});

/**
 * Tipo de invitación (precio 0) para un evento con lista de invitados. En un evento con
 * venta no se crea: ahí un tipo gratis quedaría a la venta en la web, así que las cortesías
 * salen de los tipos existentes y ocupan su cupo.
 */
export async function createGuestTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff([...ROLES.manage, ...ROLES.client]);
  const parsed = guestTypeSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const data = parsed.data;

  const session = await prisma.eventSession.findUnique({ where: { id: data.sessionId } });
  const event = session && (await guestEvent(staff, session.eventId));
  if (!session || !event) return { error: "Función no encontrada." };
  if (event.mode !== "GUEST_LIST") {
    return { error: "Este evento tiene venta: las invitaciones salen de sus tipos de entrada generales." };
  }
  if (data.sectionId) {
    const section = await prisma.section.findFirst({ where: { id: data.sectionId, venueId: session.venueId } });
    if (!section || section.seatingMode !== "GENERAL_ADMISSION") {
      return { fieldErrors: { sectionId: "Elige una sección general (las invitaciones no eligen butaca)." } };
    }
    if (data.capacity > section.capacity) {
      return { fieldErrors: { capacity: `"${section.name}" admite como máximo ${section.capacity} personas.` } };
    }
  }

  const type = await prisma.ticketType.create({
    data: {
      sessionId: session.id,
      sectionId: data.sectionId ?? null,
      name: data.name,
      unitAmount: 0,
      currency: staff.organization.currency,
      capacity: data.capacity,
      maxPerOrder: 1,
      sortOrder: await prisma.ticketType.count({ where: { sessionId: session.id } }),
    },
  });
  await logAudit({ actorType: "staff", actorId: staff.id, action: "guest_type.create", entity: "TicketType", entityId: type.id });
  revalidateGuests(session.eventId, session.id);
  return { ok: true };
}

/** Carga invitados pegados desde Excel o desde un archivo CSV: cada uno recibe su QR. */
export async function addGuestsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff([...ROLES.manage, ...ROLES.client]);
  const type = await prisma.ticketType.findUnique({
    where: { id: String(formData.get("ticketTypeId") ?? "") },
    include: { session: true },
  });
  if (!type || !(await guestEvent(staff, type.session.eventId))) {
    return { fieldErrors: { ticketTypeId: "Elige el tipo de invitación." } };
  }

  let text = String(formData.get("list") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 1_000_000) return { fieldErrors: { file: "El archivo supera 1 MB." } };
    if (/\.xlsx?$/i.test(file.name)) {
      return { fieldErrors: { file: "En Excel usa Archivo → Guardar como → CSV, o copia las columnas y pégalas." } };
    }
    text += `\n${await file.text()}`;
  }

  const { guests, errors } = parseGuestList(text);
  if (errors.length > 0) {
    const shown = errors.slice(0, 8);
    if (errors.length > shown.length) shown.push(`…y ${errors.length - shown.length} error(es) más.`);
    return { error: "Revisa la lista.", fieldErrors: Object.fromEntries(shown.map((e, i) => [`line${i}`, e])) };
  }
  if (guests.length === 0) return { fieldErrors: { list: "Pega la lista o sube un archivo CSV." } };

  try {
    await issueGuestTickets({ ticketTypeId: type.id, guests, staffId: staff.id });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidateGuests(type.session.eventId, type.sessionId);
  return { ok: true };
}

export async function cancelGuestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff([...ROLES.manage, ...ROLES.client]);
  const ticket = await prisma.ticket.findUnique({
    where: { id: String(formData.get("ticketId")) },
    include: { session: true },
  });
  if (!ticket || !(await guestEvent(staff, ticket.session.eventId))) return { error: "Invitación no encontrada." };
  try {
    await cancelGuestTicket({ ticketId: ticket.id, staffId: staff.id });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidateGuests(ticket.session.eventId, ticket.sessionId);
  return { ok: true };
}
