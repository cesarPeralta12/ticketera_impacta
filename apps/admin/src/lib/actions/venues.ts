"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  MAX_ROWS,
  MAX_SEATS_PER_ROW,
  TABLE_RADIUS,
  computeSeatPositions,
  isTablesLayout,
  parseMapItems,
  parseTables,
  parseZoneLayout,
  tableName,
  type PlacedTable,
  type SectionShape,
  type ZoneShape,
} from "@ticketera/core";
import { Prisma, prisma } from "@ticketera/db";
import { formObject, intField, zodErrors, type FormState } from "@/lib/forms";
import { requireEditor } from "@/lib/session";
import { TIMEZONES } from "@/lib/timezones";
import { logAudit } from "@/lib/audit";

async function ownedVenue(organizationId: string, venueId: string) {
  return prisma.venue.findFirst({ where: { id: venueId, organizationId } });
}

function isUnique(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

const venueSchema = z.object({
  name: z.string({ error: "Ingresa el nombre." }).min(2).max(120),
  address: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  timezone: z.enum(TIMEZONES as [string, ...string[]]),
});

export async function createVenueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const parsed = venueSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  // Todo recinto nace con una puerta: sin ella no se puede asignar un portero. Se renombra o se agregan más en el recinto.
  const venue = await prisma.venue.create({
    data: { organizationId: staff.organization.id, ...parsed.data, accessPoints: { create: [{ name: "Puerta principal" }] } },
  });
  redirect(`/recintos/${venue.id}`);
}

const gaSectionSchema = z.object({
  venueId: z.string(),
  name: z.string({ error: "Ingresa el nombre." }).min(2).max(60),
  capacity: intField(1, 200_000, "El aforo"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido."),
});

/**
 * Lee la forma de la zona que manda el editor (JSON en el campo `zone`). Vacío = sin forma: la zona queda solo
 * en la lista y se puede colocar en el mapa después.
 */
function readZone(formData: FormData): { ok: true; zone: ZoneShape | null } | { ok: false; error: string } {
  const raw = String(formData.get("zone") ?? "").trim();
  if (!raw) return { ok: true, zone: null };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "La forma de la zona no es válida." };
  }
  const parsed = parseZoneLayout(json);
  return parsed.ok ? { ok: true, zone: parsed.zone } : { ok: false, error: parsed.error };
}

/** Crea una zona de entrada general (sin butacas), con su forma en el mapa si el editor la mandó. */
export async function addGeneralSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const parsed = gaSectionSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const venue = await ownedVenue(staff.organization.id, parsed.data.venueId);
  if (!venue) return { error: "Recinto no encontrado." };
  const zone = readZone(formData);
  if (!zone.ok) return { error: zone.error };
  try {
    await prisma.section.create({
      data: {
        venueId: venue.id,
        name: parsed.data.name,
        color: parsed.data.color,
        capacity: parsed.data.capacity,
        seatingMode: "GENERAL_ADMISSION",
        ...(zone.zone ? { layout: zone.zone } : {}),
        sortOrder: await prisma.section.count({ where: { venueId: venue.id } }),
      },
    });
  } catch (error) {
    if (isUnique(error)) return { fieldErrors: { name: "Ya existe una sección con ese nombre." } };
    throw error;
  }
  revalidatePath(`/recintos/${venue.id}`);
  return { ok: true };
}

const gaUpdateSchema = z.object({
  sectionId: z.string(),
  name: z.string({ error: "Ingresa el nombre." }).min(2).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido."),
});

/**
 * Cambia el nombre, el color y la forma en el mapa de una zona general. Vale también con ventas: es solo cómo
 * se ve. El aforo no se toca aquí (las entradas ya vendidas dependen de él). Sin forma = se quita del mapa.
 */
export async function updateGeneralSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const parsed = gaUpdateSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const section = await prisma.section.findFirst({
    where: { id: parsed.data.sectionId, seatingMode: "GENERAL_ADMISSION", venue: { organizationId: staff.organization.id } },
  });
  if (!section) return { error: "Sección no encontrada." };
  const zone = readZone(formData);
  if (!zone.ok) return { error: zone.error };
  try {
    await prisma.section.update({
      where: { id: section.id },
      data: { name: parsed.data.name, color: parsed.data.color, layout: zone.zone ?? Prisma.DbNull },
    });
  } catch (error) {
    if (isUnique(error)) return { fieldErrors: { name: "Ya existe una sección con ese nombre." } };
    throw error;
  }
  revalidatePath(`/recintos/${section.venueId}`);
  return { ok: true };
}

/** Valida la "receta" de forma que manda el editor (código del prototipo del compañero). */
function parseShape(raw: string): SectionShape | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const s = parsed as Record<string, unknown>;
  const rows = Number(s.rows);
  const seatsPerRow = Number(s.seatsPerRow);
  if (!Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) return null;
  if (!Number.isInteger(seatsPerRow) || seatsPerRow < 1 || seatsPerRow > MAX_SEATS_PER_ROW) return null;

  if (s.type === "grid") {
    const [x, y, seatGap, rowGap] = [s.x, s.y, s.seatGap, s.rowGap].map(Number) as [number, number, number, number];
    if (![x, y, seatGap, rowGap].every(Number.isFinite)) return null;
    return { type: "grid", rows, seatsPerRow, x, y, seatGap, rowGap };
  }
  if (s.type === "arc") {
    const values = [s.centerX, s.centerY, s.startRadius, s.rowGap, s.startAngleDeg, s.spanDeg].map(Number);
    if (!values.every(Number.isFinite)) return null;
    const [centerX, centerY, startRadius, rowGap, startAngleDeg, spanDeg] = values as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    return { type: "arc", rows, seatsPerRow, centerX, centerY, startRadius, rowGap, startAngleDeg, spanDeg };
  }
  return null;
}

/** Crea una sección numerada con sus butacas (grilla o arco) en el mapa del recinto. */
export async function addSeatSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const venue = await ownedVenue(staff.organization.id, String(formData.get("venueId")));
  if (!venue) return { error: "Recinto no encontrado." };

  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "");
  if (name.length < 2) return { error: "Ponle un nombre a la sección." };
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Color inválido." };
  const shape = parseShape(String(formData.get("shape") ?? ""));
  if (!shape) return { error: "La forma de la sección no es válida." };

  const positions = computeSeatPositions(shape);
  try {
    await prisma.section.create({
      data: {
        venueId: venue.id,
        name,
        color,
        seatingMode: "RESERVED",
        capacity: positions.length,
        layout: shape,
        sortOrder: await prisma.section.count({ where: { venueId: venue.id } }),
        seats: { createMany: { data: positions.map((p) => ({ ...p, label: `Fila ${p.row} · ${p.number}` })) } },
      },
    });
  } catch (error) {
    if (isUnique(error)) return { error: "Ya existe una sección con ese nombre." };
    throw error;
  }
  revalidatePath(`/recintos/${venue.id}`);
  return { ok: true };
}

/** Entradas vendidas o reservadas (en cualquier estado) de una sección. */
async function sectionSales(sectionId: string) {
  return prisma.orderItem.count({ where: { ticketType: { sectionId } } });
}

/**
 * Borra una sección con sus butacas. Si tenía precio en funciones pero ninguna venta,
 * también se quitan esos tipos de entrada. Con ventas no se puede: hay entradas emitidas
 * o reservas que apuntan a sus butacas.
 */
export async function deleteSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const section = await prisma.section.findFirst({
    where: { id: String(formData.get("sectionId")), venue: { organizationId: staff.organization.id } },
  });
  if (!section) return { error: "Sección no encontrada." };
  if ((await sectionSales(section.id)) > 0) {
    return { error: `"${section.name}" ya tiene entradas vendidas o reservadas: no se puede borrar.` };
  }
  await prisma.$transaction([
    prisma.ticketType.deleteMany({ where: { sectionId: section.id } }),
    prisma.section.delete({ where: { id: section.id } }),
  ]);
  await logAudit({ actorType: "staff", actorId: staff.id, action: "section.delete", entity: "Section", entityId: section.id });
  revalidatePath(`/recintos/${section.venueId}`);
  return { ok: true };
}

/**
 * Edita una sección numerada: nombre y color siempre; la forma (posición, filas, butacas)
 * solo si no tiene ventas, porque cambiarla vuelve a crear las butacas.
 */
export async function updateSeatSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const section = await prisma.section.findFirst({
    where: { id: String(formData.get("sectionId")), venue: { organizationId: staff.organization.id } },
  });
  if (!section || section.seatingMode !== "RESERVED") return { error: "Sección no encontrada." };

  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "");
  if (name.length < 2) return { error: "Ponle un nombre a la sección." };
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Color inválido." };
  const shape = parseShape(String(formData.get("shape") ?? ""));
  if (!shape) return { error: "La forma de la sección no es válida." };

  const shapeChanged = JSON.stringify(shape) !== JSON.stringify(section.layout);
  if (shapeChanged && (await sectionSales(section.id)) > 0) {
    return {
      error: `"${section.name}" ya tiene entradas vendidas o reservadas: solo puedes cambiar su nombre y color.`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.section.update({ where: { id: section.id }, data: { name, color } });
      if (!shapeChanged) return;
      const positions = computeSeatPositions(shape);
      await tx.seat.deleteMany({ where: { sectionId: section.id } });
      await tx.seat.createMany({
        data: positions.map((p) => ({ ...p, sectionId: section.id, label: `Fila ${p.row} · ${p.number}` })),
      });
      await tx.section.update({ where: { id: section.id }, data: { layout: shape, capacity: positions.length } });
      // En una sección numerada el cupo de cada precio es su cantidad de butacas.
      await tx.ticketType.updateMany({ where: { sectionId: section.id }, data: { capacity: positions.length } });
    });
  } catch (error) {
    if (isUnique(error)) return { error: "Ya existe una sección con ese nombre." };
    throw error;
  }
  await logAudit({
      actorType: "staff",
      actorId: staff.id,
      action: "section.update",
      entity: "Section",
      entityId: section.id,
      data: { shapeChanged },
    });
  revalidatePath(`/recintos/${section.venueId}`);
  return { ok: true };
}

export async function addAccessPointAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const venue = await ownedVenue(staff.organization.id, String(formData.get("venueId")));
  const name = String(formData.get("name") ?? "").trim();
  if (!venue) return { error: "Recinto no encontrado." };
  if (name.length < 2) return { fieldErrors: { name: "Ingresa un nombre." } };
  try {
    await prisma.accessPoint.create({ data: { venueId: venue.id, name } });
  } catch (error) {
    if (isUnique(error)) return { fieldErrors: { name: "Ya existe ese acceso." } };
    throw error;
  }
  revalidatePath(`/recintos/${venue.id}`);
  return { ok: true };
}

/**
 * Qué secciones entran por esta puerta. Sin ninguna marcada, la puerta acepta todas. Así,
 * sin internet, dos puertas no pueden aceptar la misma entrada: cada una tiene sus secciones.
 */
export async function updateAccessPointSectionsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const gate = await prisma.accessPoint.findFirst({
    where: { id: String(formData.get("accessPointId")), venue: { organizationId: staff.organization.id } },
  });
  if (!gate) return { error: "Puerta no encontrada." };
  const requested = formData.getAll("sectionIds").map(String);
  const sections = await prisma.section.findMany({ where: { id: { in: requested }, venueId: gate.venueId }, select: { id: true } });

  await prisma.accessPoint.update({ where: { id: gate.id }, data: { sections: { set: sections } } });
  await logAudit({
      actorType: "staff",
      actorId: staff.id,
      action: "access_point.sections",
      entity: "AccessPoint",
      entityId: gate.id,
      data: { sections: sections.map((s) => s.id) },
    });
  revalidatePath(`/recintos/${gate.venueId}`);
  return { ok: true };
}

export async function deleteAccessPointAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const gate = await prisma.accessPoint.findFirst({
    where: { id: String(formData.get("accessPointId")), venue: { organizationId: staff.organization.id } },
    include: { _count: { select: { scans: true } } },
  });
  if (!gate) return { error: "Puerta no encontrada." };
  // Las lecturas guardan por qué puerta entró cada persona: esa historia no se borra.
  if (gate._count.scans > 0) return { error: `"${gate.name}" ya registró lecturas: no se puede borrar.` };
  await prisma.accessPoint.delete({ where: { id: gate.id } });
  revalidatePath(`/recintos/${gate.venueId}`);
  return { ok: true };
}

type PlanGroup = { sectionId?: string; name: string; color: string; prefix: string; tables: PlacedTable[] };

/** Lee y valida el plano que manda el editor de boliche. */
function parsePlan(raw: string): { ok: true; items: NonNullable<ReturnType<typeof parseMapItems>>; groups: PlanGroup[] } | { ok: false; error: string } {
  let plan: { items?: unknown; groups?: unknown };
  try {
    plan = JSON.parse(raw) as typeof plan;
  } catch {
    return { ok: false, error: "El plano no es válido." };
  }
  const items = parseMapItems(plan.items ?? []);
  if (!items) return { ok: false, error: "Algún elemento del plano no es válido." };
  if (!Array.isArray(plan.groups) || plan.groups.length > 20) return { ok: false, error: "Los grupos de lounges no son válidos." };
  const groups: PlanGroup[] = [];
  for (const g of plan.groups as Record<string, unknown>[]) {
    const name = String(g.name ?? "").trim();
    const color = String(g.color ?? "");
    const prefix = String(g.prefix ?? "").trim().slice(0, 20) || "Lounge";
    if (name.length < 2 || name.length > 60) return { ok: false, error: "Cada grupo de lounges necesita un nombre (ej. Lounges VIP)." };
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, error: `Color inválido en "${name}".` };
    const tables = parseTables(g.tables, TABLE_RADIUS);
    if (!tables.ok) return { ok: false, error: `${name}: ${tables.error}` };
    groups.push({ ...(typeof g.sectionId === "string" && g.sectionId ? { sectionId: g.sectionId } : {}), name, color, prefix, tables: tables.tables });
  }
  if (new Set(groups.map((g) => g.name.toLowerCase())).size !== groups.length) return { ok: false, error: "Dos grupos de lounges tienen el mismo nombre." };
  return { ok: true, items, groups };
}

/**
 * Guarda el plano de un boliche: los elementos (escenario, barras, DJ…) y los grupos de lounges en círculo.
 * Cada grupo es una sección numerada cuyas "butacas" son los lounges (el comprador elige el suyo en el mapa).
 * Un lounge con ventas o reservas se puede mover pero no quitar; el cupo de sus precios es la cantidad de lounges.
 */
export async function saveClubPlanAction(venueId: string, planJson: string): Promise<FormState> {
  const staff = await requireEditor();
  const venue = await ownedVenue(staff.organization.id, venueId);
  if (!venue) return { error: "Recinto no encontrado." };
  const plan = parsePlan(planJson);
  if (!plan.ok) return { error: plan.error };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.venue.update({ where: { id: venue.id }, data: { mapItems: plan.items } });
      for (const group of plan.groups) {
        const layout = { type: "tables" as const, radius: TABLE_RADIUS, prefix: group.prefix };
        const seatData = (t: PlacedTable) => ({ row: "L", number: String(t.number), label: tableName(group.prefix, t.number), x: t.x, y: t.y });

        if (!group.sectionId) {
          await tx.section.create({
            data: {
              venueId: venue.id,
              name: group.name,
              color: group.color,
              seatingMode: "RESERVED",
              capacity: group.tables.length,
              layout,
              sortOrder: await tx.section.count({ where: { venueId: venue.id } }),
              seats: { createMany: { data: group.tables.map(seatData) } },
            },
          });
          continue;
        }

        const section = await tx.section.findFirst({ where: { id: group.sectionId, venueId: venue.id }, include: { seats: { include: { _count: { select: { orderItems: true } } } } } });
        if (!section || !isTablesLayout(section.layout)) throw new PlanError(`El grupo "${group.name}" ya no existe: recarga la página.`);
        const kept = new Set(group.tables.flatMap((t) => (t.id ? [t.id] : [])));
        const removed = section.seats.filter((seat) => !kept.has(seat.id));
        const sold = removed.find((seat) => seat._count.orderItems > 0);
        if (sold) throw new PlanError(`${sold.label} ya tiene ventas o reservas: se puede mover, pero no quitar.`);
        if (removed.length) await tx.seat.deleteMany({ where: { id: { in: removed.map((seat) => seat.id) } } });
        const existing = new Map(section.seats.map((seat) => [seat.id, seat]));
        for (const t of group.tables) {
          if (t.id && existing.has(t.id)) {
            // El número de un lounge no cambia (sus entradas lo nombran así); se mueve y toma el nombre del grupo.
            const seat = existing.get(t.id)!;
            await tx.seat.update({ where: { id: seat.id }, data: { x: t.x, y: t.y, label: tableName(group.prefix, seat.number) } });
          } else {
            await tx.seat.create({ data: { sectionId: section.id, ...seatData(t) } });
          }
        }
        await tx.section.update({ where: { id: section.id }, data: { name: group.name, color: group.color, layout, capacity: group.tables.length } });
        // En una sección numerada el cupo de cada precio es su cantidad de lugares (aquí, de lounges).
        await tx.ticketType.updateMany({ where: { sectionId: section.id }, data: { capacity: group.tables.length } });
      }
    });
  } catch (error) {
    if (error instanceof PlanError) return { error: error.message };
    if (isUnique(error)) return { error: "Ya existe una sección con ese nombre o dos lounges con el mismo número." };
    throw error;
  }
  await logAudit({
    actorType: "staff",
    actorId: staff.id,
    action: "venue.plan",
    entity: "Venue",
    entityId: venue.id,
    data: { items: plan.items.length, groups: plan.groups.map((g) => ({ name: g.name, tables: g.tables.length })) },
  });
  revalidatePath(`/recintos/${venue.id}`);
  const tables = plan.groups.reduce((n, g) => n + g.tables.length, 0);
  return { ok: true, message: `Plano guardado: ${plan.items.length} elemento(s) y ${tables} lounge(s).` };
}

class PlanError extends Error {}
