"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_PHASES, saleState, zonedDateTimeToUtc } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { formObject, intField, moneyField, zodErrors, type FormState } from "@/lib/forms";
import { requireEditor } from "@/lib/session";
import { logAudit } from "@/lib/audit";

async function audit(actorId: string, action: string, entityId: string, data?: object) {
  await logAudit({ actorType: "staff", actorId, action, entity: "TicketType", entityId, data: data ? JSON.parse(JSON.stringify(data)) : undefined });
}

const phaseSchema = z.object({
  name: z.string().min(1).max(60, "El nombre es muy largo."),
  price: moneyField,
  capacity: intField(1, 1_000_000, "El cupo"),
  startsAt: z.string().optional(),
});

const phasesSchema = z.object({
  sessionId: z.string(),
  sectionId: z.string({ error: "Elige la sección." }),
  /** Desde cuándo se vende la primera fase (vacío: desde ya, como la función). */
  firstStartsAt: z.string().optional(),
  maxPerOrder: intField(1, 10, "El máximo por compra"),
  reentry: z.enum(["yes", "no"]).optional(),
});

/** Fila i del formulario (name0, price0, capacity0, startsAt0…). Vacía si no tiene nombre. */
function phaseRow(raw: Record<string, string | undefined>, i: number) {
  if (!raw[`name${i}`]) return null;
  return { name: raw[`name${i}`], price: raw[`price${i}`], capacity: raw[`capacity${i}`], startsAt: raw[`startsAt${i}`] };
}

/**
 * Crea las fases de venta de una sección general: varios precios que se venden uno después del otro. La siguiente
 * toma el lugar cuando se agota la anterior o cuando llega su fecha (lo primero que pase).
 */
export async function createPhasesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const raw = formObject(formData);
  const parsed = phasesSchema.safeParse(raw);
  if (!parsed.success) return zodErrors(parsed.error);
  const data = parsed.data;

  const session = await prisma.eventSession.findFirst({
    where: { id: data.sessionId, event: { organizationId: staff.organization.id } },
    include: { venue: { select: { timezone: true } }, event: { select: { mode: true } } },
  });
  const section = await prisma.section.findFirst({ where: { id: data.sectionId, venueId: session?.venueId } });
  if (!session || !section) return { error: "Función o sección no encontrada." };
  if (session.event.mode !== "TICKETING") return { error: "Las fases son para eventos con venta de entradas, no para listas de invitados." };
  if (section.seatingMode !== "GENERAL_ADMISSION") {
    return { fieldErrors: { sectionId: `"${section.name}" tiene lugares numerados: las fases son para secciones generales (de pie o sin butaca fija).` } };
  }

  // Las filas con nombre, en orden; cada una con su precio, cupo y (desde la segunda) fecha opcional.
  const fieldErrors: Record<string, string> = {};
  const tz = session.venue.timezone;
  const toDate = (value: string | undefined, field: string) => {
    if (!value) return null;
    try {
      return zonedDateTimeToUtc(value, tz);
    } catch {
      fieldErrors[field] = "Fecha inválida.";
      return null;
    }
  };
  const phases: { name: string; price: number; capacity: number; startsAt: Date | null }[] = [];
  for (let i = 0; i < MAX_PHASES; i++) {
    const row = phaseRow(raw, i);
    if (!row) continue;
    const phase = phaseSchema.safeParse(row);
    if (!phase.success) {
      for (const issue of phase.error.issues) fieldErrors[`${String(issue.path[0])}${i}`] ??= issue.message;
      continue;
    }
    if (phase.data.capacity > section.capacity) fieldErrors[`capacity${i}`] = `"${section.name}" admite como máximo ${section.capacity} personas.`;
    phases.push({ ...phase.data, startsAt: phases.length === 0 ? null : toDate(phase.data.startsAt, `startsAt${i}`) });
  }
  const firstStartsAt = toDate(data.firstStartsAt, "firstStartsAt");
  if (Object.keys(fieldErrors).length > 0) return { error: "Revisa los campos marcados.", fieldErrors };
  if (phases.length < 2) return { error: "Carga al menos dos fases (ej. Fase Hot y Fase 1)." };
  if (new Set(phases.map((p) => p.name.toLowerCase())).size !== phases.length) return { error: "Cada fase tiene que tener un nombre distinto." };

  // Las fechas, en orden: una fase no puede empezar antes que la anterior.
  let previous = firstStartsAt;
  for (const p of phases) {
    if (!p.startsAt) continue;
    if (previous && p.startsAt <= previous) return { error: `"${p.name}" tiene que empezar después que la fase anterior.` };
    if (session.salesEndAt && p.startsAt >= session.salesEndAt) return { error: `"${p.name}" empieza cuando la venta de la función ya cerró.` };
    previous = p.startsAt;
  }

  // Una sola cadena de fases por sección, y nada más a la venta en ella: si no, se venderían a la vez.
  const existing = await prisma.ticketType.findMany({ where: { sessionId: session.id, sectionId: section.id } });
  if (existing.some((t) => t.phaseOrder !== null)) return { error: `"${section.name}" ya tiene fases en esta función: agrega o cambia las fases ahí.` };
  const onSale = existing.find((t) => saleState(t) !== "closed");
  if (onSale) {
    return {
      error: `"${section.name}" ya tiene el precio "${onSale.name}" a la venta: se vendería a la vez que las fases. Bórralo o termina su venta (Ajustes → Fechas → Hasta) y vuelve a intentar.`,
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    const sortOrder = await tx.ticketType.count({ where: { sessionId: session.id } });
    return Promise.all(
      phases.map((p, i) =>
        tx.ticketType.create({
          data: {
            sessionId: session.id,
            sectionId: section.id,
            name: p.name,
            unitAmount: p.price,
            currency: staff.organization.currency,
            capacity: p.capacity,
            // Gratis (lista free): una por persona; createPendingOrder también lo exige.
            maxPerOrder: p.price === 0 ? 1 : data.maxPerOrder,
            maxEntries: data.reentry === "yes" ? 0 : 1,
            salesStartAt: i === 0 ? firstStartsAt : null,
            phaseOrder: i + 1,
            phaseStartsAt: p.startsAt,
            sortOrder: sortOrder + i,
          },
        }),
      ),
    );
  });
  await audit(staff.id, "ticket_type.phases_create", created[0]!.id, {
    section: section.id,
    phases: phases.map((p) => ({ name: p.name, price: p.price, capacity: p.capacity, startsAt: p.startsAt?.toISOString() ?? null })),
  });
  revalidatePath(`/eventos/${session.eventId}/funciones/${session.id}`);
  return { ok: true, message: `Listo: ${phases.length} fases en "${section.name}". Se vende primero "${phases[0]!.name}".` };
}

/**
 * Cambia cuándo empieza una fase (vacío: cuando se agote la anterior). Con `now`, empieza ya: es "pasar a la siguiente
 * fase" a mano, aunque la anterior no se haya agotado.
 */
export async function setPhaseStartAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const type = await prisma.ticketType.findFirst({
    where: { id: String(formData.get("ticketTypeId")), phaseOrder: { not: null }, session: { event: { organizationId: staff.organization.id } } },
    include: { session: { include: { venue: { select: { timezone: true } } } } },
  });
  if (!type) return { error: "Fase no encontrada." };
  const siblings = await prisma.ticketType.findMany({
    where: { sessionId: type.sessionId, sectionId: type.sectionId, phaseOrder: { not: null } },
    orderBy: { phaseOrder: "asc" },
  });
  if (siblings[0]?.id === type.id) return { error: "La primera fase se vende desde el principio: su inicio se cambia en sus fechas de venta." };

  const now = formData.get("now") === "1";
  let startsAt: Date | null = null;
  if (now) startsAt = new Date();
  else if (formObject(formData).startsAt) {
    try {
      startsAt = zonedDateTimeToUtc(String(formData.get("startsAt")), type.session.venue.timezone);
    } catch {
      return { fieldErrors: { startsAt: "Fecha inválida." } };
    }
  }
  if (startsAt && !now) {
    const index = siblings.findIndex((t) => t.id === type.id);
    const before = siblings.slice(0, index).findLast((t) => t.phaseStartsAt)?.phaseStartsAt;
    const after = siblings.slice(index + 1).find((t) => t.phaseStartsAt)?.phaseStartsAt;
    if (before && startsAt <= before) return { fieldErrors: { startsAt: "Tiene que empezar después que la fase anterior." } };
    if (after && startsAt >= after) return { fieldErrors: { startsAt: "Tiene que empezar antes que la fase siguiente." } };
  }

  await prisma.ticketType.update({ where: { id: type.id }, data: { phaseStartsAt: startsAt } });
  await audit(staff.id, now ? "ticket_type.phase_advance" : "ticket_type.phase_start", type.id, { startsAt: startsAt?.toISOString() ?? null });
  revalidatePath(`/eventos/${type.session.eventId}/funciones/${type.sessionId}`);
  return { ok: true, message: now ? `Ahora se vende "${type.name}".` : "Guardado." };
}
