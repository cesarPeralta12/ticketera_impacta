"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  MAX_ROWS,
  MAX_SEATS_PER_ROW,
  TABLE_RADIUS,
  computeSeatPositions,
  isSeatedTablesLayout,
  isTablesLayout,
  parseMapItems,
  parseTables,
  parseZoneLayout,
  safeMapUrl,
  seatShapeProblem,
  tableName,
  type PlacedTable,
  type SectionShape,
  type ZoneShape,
  parseSeatedTablesLayout,
  seatedTableSeats,
  templateSectionSeats,
  venueTemplate,
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

const venueInfoSchema = venueSchema.extend({
  venueId: z.string(),
  directions: z.string().max(1000).optional(),
  mapUrl: z
    .string()
    .max(500)
    .optional()
    .refine((v) => !v || safeMapUrl(v) !== null, "El enlace del mapa tiene que empezar con https:// (cópialo de Google Maps)."),
  parking: z.string().max(500).optional(),
  accessibility: z.string().max(500).optional(),
});

/**
 * Borra un recinto con todo lo suyo (secciones, butacas, puertas, zonas, plano). Solo si ninguna función lo usa (ni en
 * borrador ni cancelada): sus entradas y lecturas lo necesitan.
 */
export async function deleteVenueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const venue = await ownedVenue(staff.organization.id, String(formData.get("venueId") ?? ""));
  if (!venue) return { error: "Recinto no encontrado." };
  const sessions = await prisma.eventSession.count({ where: { venueId: venue.id } });
  if (sessions > 0) {
    return { error: `Lo usa${sessions === 1 ? " 1 función" : `n ${sessions} funciones`}: cámbialas de recinto o bórralas antes de borrarlo.` };
  }
  await prisma.venue.delete({ where: { id: venue.id } });
  await logAudit({ actorType: "staff", actorId: staff.id, action: "venue.delete", entity: "Venue", entityId: venue.id, data: { name: venue.name } });
  revalidatePath("/recintos");
  redirect("/recintos");
}

/** Datos del recinto: nombre, dirección, zona horaria y lo que el comprador necesita para llegar. */
export async function updateVenueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const parsed = venueInfoSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { venueId, ...data } = parsed.data;
  const venue = await ownedVenue(staff.organization.id, venueId);
  if (!venue) return { error: "Recinto no encontrado." };
  // Las horas de las funciones se guardan en UTC: cambiar la zona horaria movería la hora local de todas.
  if (data.timezone !== venue.timezone && (await prisma.eventSession.count({ where: { venueId: venue.id } })) > 0) {
    return { fieldErrors: { timezone: "Ya hay funciones en este recinto: la zona horaria no se puede cambiar." } };
  }
  await prisma.venue.update({
    where: { id: venue.id },
    data: {
      name: data.name,
      address: data.address ?? null,
      city: data.city ?? null,
      timezone: data.timezone,
      directions: data.directions ?? null,
      mapUrl: data.mapUrl ? safeMapUrl(data.mapUrl) : null,
      parking: data.parking ?? null,
      accessibility: data.accessibility ?? null,
    },
  });
  await logAudit({ actorType: "staff", actorId: staff.id, action: "venue.update", entity: "Venue", entityId: venue.id });
  revalidatePath(`/recintos/${venue.id}`);
  revalidatePath("/recintos");
  return { ok: true, message: "Datos del recinto guardados." };
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
  const problem = seatShapeProblem(shape);
  if (problem) return { error: problem };

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

/**
 * Recinto nuevo desde una plantilla (boliche, teatro, salón, aire libre): secciones, zonas, mesas, plano, zonas de
 * acceso y puertas ya armados. Después se edita como cualquier recinto.
 */
export async function createVenueFromTemplateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const template = venueTemplate(String(formData.get("template") ?? ""));
  if (!template) return { error: "Elige una plantilla." };
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (name.length < 2) return { fieldErrors: { name: "Ponle un nombre al recinto." } };
  if (await prisma.venue.findFirst({ where: { organizationId: staff.organization.id, name } })) {
    return { fieldErrors: { name: "Ya tienes un recinto con ese nombre." } };
  }
  const venue = await prisma.$transaction(async (tx) => {
    const created = await tx.venue.create({
      data: {
        organizationId: staff.organization.id,
        name,
        address: String(formData.get("address") ?? "").trim().slice(0, 200) || null,
        city: String(formData.get("city") ?? "").trim().slice(0, 80) || null,
        mapItems: template.items,
      },
    });
    for (const [i, section] of template.sections.entries()) {
      const seats = templateSectionSeats(section);
      const layout =
        section.kind === "zone"
          ? section.zone
          : section.kind === "seats"
            ? section.shape
            : section.kind === "lounges"
              ? { type: "tables" as const, radius: TABLE_RADIUS, prefix: section.prefix, shape: section.shape }
              : section.layout;
      await tx.section.create({
        data: {
          venueId: created.id,
          name: section.name,
          color: section.color,
          seatingMode: section.kind === "zone" ? "GENERAL_ADMISSION" : "RESERVED",
          capacity: section.kind === "zone" ? section.capacity : seats.length,
          layout,
          sortOrder: i,
          ...(seats.length ? { seats: { createMany: { data: seats } } } : {}),
        },
      });
    }
    const zoneIds = new Map<string, string>();
    for (const z of template.accessZones) {
      zoneIds.set(z.name, (await tx.accessZone.create({ data: { venueId: created.id, name: z.name, level: z.level, color: z.color } })).id);
    }
    for (const g of template.gates) {
      await tx.accessPoint.create({ data: { venueId: created.id, name: g.name, direction: g.direction, zoneId: g.zone ? (zoneIds.get(g.zone) ?? null) : null } });
    }
    return created;
  });
  await logAudit({ actorType: "staff", actorId: staff.id, action: "venue.create_from_template", entity: "Venue", entityId: venue.id, data: { template: template.key } });
  redirect(`/recintos/${venue.id}`);
}

const PLAN_MAX_BYTES = 4_000_000;

/** Tipo real de la imagen por sus primeros bytes (no por la extensión): PNG, JPG, WebP o SVG. */
function planImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

/** Sube (o reemplaza) la imagen del plano real para calcar en los editores; o la quita; o cambia su opacidad. */
export async function updatePlanImageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const venue = await ownedVenue(staff.organization.id, String(formData.get("venueId")));
  if (!venue) return { error: "Recinto no encontrado." };
  const opacity = Math.min(100, Math.max(5, Math.round(Number(formData.get("opacity") ?? 40)) || 40));
  if (formData.get("remove") === "1") {
    await prisma.venuePlanImage.deleteMany({ where: { venueId: venue.id } });
    revalidatePath(`/recintos/${venue.id}`);
    return { ok: true, message: "Plano de fondo quitado." };
  }
  const file = formData.get("image");
  if (file instanceof File && file.size > 0) {
    if (file.size > PLAN_MAX_BYTES) return { fieldErrors: { image: "La imagen supera 4 MB." } };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = planImageType(bytes);
    if (!type) return { fieldErrors: { image: "Sube un PNG, JPG, WebP o SVG." } };
    await prisma.venuePlanImage.upsert({
      where: { venueId: venue.id },
      create: { venueId: venue.id, data: bytes, mimeType: type, opacity },
      update: { data: bytes, mimeType: type, opacity },
    });
    await logAudit({ actorType: "staff", actorId: staff.id, action: "venue.plan_image", entity: "Venue", entityId: venue.id, data: { type, bytes: bytes.length } });
  } else {
    const { count } = await prisma.venuePlanImage.updateMany({ where: { venueId: venue.id }, data: { opacity } });
    if (count === 0) return { fieldErrors: { image: "Elige la imagen del plano." } };
  }
  revalidatePath(`/recintos/${venue.id}`);
  return { ok: true, message: "Plano de fondo guardado." };
}

/** Mesas con sillas alrededor: una sección numerada donde cada silla es una butaca (ver seated-tables.ts). */
export async function addSeatedTablesSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const venue = await ownedVenue(staff.organization.id, String(formData.get("venueId")));
  if (!venue) return { error: "Recinto no encontrado." };
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "");
  if (name.length < 2) return { error: "Ponle un nombre a la sección." };
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Color inválido." };
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("layout") ?? ""));
  } catch {
    return { error: "Las mesas no son válidas." };
  }
  const parsed = parseSeatedTablesLayout(raw);
  if (!parsed.ok) return { error: parsed.error };
  const seats = seatedTableSeats(parsed.layout);
  try {
    const section = await prisma.section.create({
      data: {
        venueId: venue.id,
        name,
        color,
        seatingMode: "RESERVED",
        capacity: seats.length,
        layout: parsed.layout,
        sortOrder: await prisma.section.count({ where: { venueId: venue.id } }),
        seats: { createMany: { data: seats } },
      },
    });
    await logAudit({
      actorType: "staff",
      actorId: staff.id,
      action: "section.seated_tables",
      entity: "Section",
      entityId: section.id,
      data: { tables: parsed.layout.tables.length, chairs: parsed.layout.chairs, mode: parsed.layout.mode },
    });
  } catch (error) {
    if (isUnique(error)) return { error: "Ya existe una sección con ese nombre." };
    throw error;
  }
  revalidatePath(`/recintos/${venue.id}`);
  return { ok: true };
}

/**
 * Recoloca las mesas de una sección de mesas con sillas ya creada: solo cambia dónde está cada mesa (y sus sillas)
 * en el mapa. Las mesas, sus números, las sillas y lo vendido quedan igual, así que se puede hacer con ventas.
 */
export async function moveSeatedTablesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const section = await prisma.section.findFirst({
    where: { id: String(formData.get("sectionId")), venue: { organizationId: staff.organization.id } },
    select: { id: true, venueId: true, layout: true },
  });
  if (!section || !isSeatedTablesLayout(section.layout)) return { error: "Sección de mesas no encontrada." };
  let moved: unknown;
  try {
    moved = JSON.parse(String(formData.get("tables") ?? ""));
  } catch {
    return { error: "Las mesas no son válidas." };
  }
  const current = section.layout;
  const byNumber = new Map(
    (Array.isArray(moved) ? moved : []).map((t: { number?: unknown; x?: unknown; y?: unknown }) => [Number(t?.number), { x: Number(t?.x), y: Number(t?.y) }]),
  );
  if (byNumber.size !== current.tables.length || current.tables.some((t) => !byNumber.has(t.number))) {
    return { error: "Las mesas cambiaron: recarga la página." };
  }
  // Nombre y tamaño solo cambian cómo se ve (las sillas siguen siendo las mismas butacas): se puede aunque haya ventas.
  const name = formData.has("name") ? String(formData.get("name")).trim() : null;
  if (name !== null && name.length < 2) return { error: "Ponle un nombre a la sección." };
  const size = formData.get("size") ? Number(formData.get("size")) : current.size;
  const parsed = parseSeatedTablesLayout({ ...current, size, tables: current.tables.map((t) => ({ number: t.number, ...byNumber.get(t.number)! })) });
  if (!parsed.ok) return { error: parsed.error };
  const seats = seatedTableSeats(parsed.layout);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.section.update({ where: { id: section.id }, data: { layout: parsed.layout, ...(name ? { name } : {}) } });
      for (const seat of seats) {
        await tx.seat.updateMany({ where: { sectionId: section.id, row: seat.row, number: seat.number }, data: { x: seat.x, y: seat.y } });
      }
    });
  } catch (error) {
    if (isUnique(error)) return { error: "Ya existe una sección con ese nombre." };
    throw error;
  }
  await logAudit({
    actorType: "staff",
    actorId: staff.id,
    action: "section.seated_tables_moved",
    entity: "Section",
    entityId: section.id,
    data: { tables: parsed.layout.tables.length, size: parsed.layout.size },
  });
  revalidatePath(`/recintos/${section.venueId}`);
  return { ok: true, message: "Cambios guardados." };
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
  // Solo si cambia la forma: una sección vieja que no cumple igual puede cambiar de nombre o color.
  const problem = shapeChanged ? seatShapeProblem(shape) : null;
  if (problem) return { error: problem };
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
  // Dirección (entrada, salida o ambas) y zona a la que da la puerta.
  const direction = (["IN", "OUT", "BOTH"] as const).find((d) => d === formData.get("direction")) ?? gate.direction;
  const zoneId = String(formData.get("zoneId") ?? "");
  const zone = zoneId ? await prisma.accessZone.findFirst({ where: { id: zoneId, venueId: gate.venueId }, select: { id: true } }) : null;

  await prisma.accessPoint.update({ where: { id: gate.id }, data: { sections: { set: sections }, direction, zoneId: zone?.id ?? null } });
  await logAudit({
      actorType: "staff",
      actorId: staff.id,
      action: "access_point.sections",
      entity: "AccessPoint",
      entityId: gate.id,
      data: { sections: sections.map((s) => s.id), direction, zoneId: zone?.id ?? null },
    });
  revalidatePath(`/recintos/${gate.venueId}`);
  return { ok: true };
}

const zoneSchema = z.object({
  name: z.string({ error: "Ingresa un nombre." }).trim().min(2, "Ingresa un nombre.").max(40),
  level: intField(0, 9, "El nivel"),
  capacity: intField(1, 200_000, "El aforo").optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido.").default("#2E9E6A"),
  /** Casilla "bloquear al llenarse": con el aforo lleno, la puerta no deja entrar (sin marcar, el aforo solo informa). */
  blockWhenFull: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
});

/** Zona de acceso del recinto (Exterior, General, VIP…): las puertas dan a una zona y cada tipo de entrada abre las suyas. */
export async function addZoneAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const venue = await ownedVenue(staff.organization.id, String(formData.get("venueId")));
  if (!venue) return { error: "Recinto no encontrado." };
  const parsed = zoneSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  if (parsed.data.blockWhenFull && !parsed.data.capacity) return { fieldErrors: { capacity: "Para bloquear al llenarse, pon el aforo." } };
  try {
    const zone = await prisma.accessZone.create({ data: { venueId: venue.id, ...parsed.data } });
    await logAudit({ actorType: "staff", actorId: staff.id, action: "zone.create", entity: "AccessZone", entityId: zone.id });
  } catch (error) {
    if (isUnique(error)) return { fieldErrors: { name: "Ya existe una zona con ese nombre." } };
    throw error;
  }
  revalidatePath(`/recintos/${venue.id}`);
  return { ok: true };
}

export async function updateZoneAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const zone = await prisma.accessZone.findFirst({
    where: { id: String(formData.get("zoneId")), venue: { organizationId: staff.organization.id } },
  });
  if (!zone) return { error: "Zona no encontrada." };
  const parsed = zoneSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  if (parsed.data.blockWhenFull && !parsed.data.capacity) return { fieldErrors: { capacity: "Para bloquear al llenarse, pon el aforo." } };
  try {
    await prisma.accessZone.update({ where: { id: zone.id }, data: { ...parsed.data, capacity: parsed.data.capacity ?? null } });
  } catch (error) {
    if (isUnique(error)) return { fieldErrors: { name: "Ya existe una zona con ese nombre." } };
    throw error;
  }
  revalidatePath(`/recintos/${zone.venueId}`);
  return { ok: true };
}

/** Borra una zona: sus puertas quedan como ingreso general y los tipos de entrada dejan de abrirla. */
export async function deleteZoneAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const zone = await prisma.accessZone.findFirst({
    where: { id: String(formData.get("zoneId")), venue: { organizationId: staff.organization.id } },
    include: { _count: { select: { inside: true } } },
  });
  if (!zone) return { error: "Zona no encontrada." };
  if (zone._count.inside > 0) return { error: `Hay ${zone._count.inside} persona(s) adentro de "${zone.name}" ahora: no se puede borrar.` };
  await prisma.accessZone.delete({ where: { id: zone.id } });
  await logAudit({ actorType: "staff", actorId: staff.id, action: "zone.delete", entity: "AccessZone", entityId: zone.id, data: { name: zone.name } });
  revalidatePath(`/recintos/${zone.venueId}`);
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

type PlanGroup = { sectionId?: string; name: string; color: string; prefix: string; shape: "round" | "rect"; tables: PlacedTable[] };

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
    const shape = g.shape === "rect" ? ("rect" as const) : ("round" as const);
    groups.push({ ...(typeof g.sectionId === "string" && g.sectionId ? { sectionId: g.sectionId } : {}), name, color, prefix, shape, tables: tables.tables });
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
        const layout = { type: "tables" as const, radius: TABLE_RADIUS, prefix: group.prefix, shape: group.shape };
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
  return { ok: true, message: `Plano guardado: ${plan.items.length} elemento(s)${plan.groups.length ? ` y ${tables} lounge(s)` : ""}.` };
}

class PlanError extends Error {}
