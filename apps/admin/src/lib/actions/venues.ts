"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MAX_ROWS, MAX_SEATS_PER_ROW, computeSeatPositions, type SectionShape } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { formObject, intField, zodErrors, type FormState } from "@/lib/forms";
import { ROLES, requireStaff } from "@/lib/session";
import { TIMEZONES } from "@/lib/timezones";

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
  const staff = await requireStaff(ROLES.manage);
  const parsed = venueSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const venue = await prisma.venue.create({ data: { organizationId: staff.organization.id, ...parsed.data } });
  redirect(`/recintos/${venue.id}`);
}

const gaSectionSchema = z.object({
  venueId: z.string(),
  name: z.string({ error: "Ingresa el nombre." }).min(2).max(60),
  capacity: intField(1, 200_000, "El aforo"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido."),
});

export async function addGeneralSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const parsed = gaSectionSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const venue = await ownedVenue(staff.organization.id, parsed.data.venueId);
  if (!venue) return { error: "Recinto no encontrado." };
  try {
    await prisma.section.create({
      data: {
        venueId: venue.id,
        name: parsed.data.name,
        color: parsed.data.color,
        capacity: parsed.data.capacity,
        seatingMode: "GENERAL_ADMISSION",
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
  const staff = await requireStaff(ROLES.manage);
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
  const staff = await requireStaff(ROLES.manage);
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
  await prisma.auditLog.create({
    data: { actorType: "staff", actorId: staff.id, action: "section.delete", entity: "Section", entityId: section.id },
  });
  revalidatePath(`/recintos/${section.venueId}`);
  return { ok: true };
}

/**
 * Edita una sección numerada: nombre y color siempre; la forma (posición, filas, butacas)
 * solo si no tiene ventas, porque cambiarla vuelve a crear las butacas.
 */
export async function updateSeatSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
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
  await prisma.auditLog.create({
    data: {
      actorType: "staff",
      actorId: staff.id,
      action: "section.update",
      entity: "Section",
      entityId: section.id,
      data: { shapeChanged },
    },
  });
  revalidatePath(`/recintos/${section.venueId}`);
  return { ok: true };
}

export async function addAccessPointAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
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
  const staff = await requireStaff(ROLES.manage);
  const gate = await prisma.accessPoint.findFirst({
    where: { id: String(formData.get("accessPointId")), venue: { organizationId: staff.organization.id } },
  });
  if (!gate) return { error: "Puerta no encontrada." };
  const requested = formData.getAll("sectionIds").map(String);
  const sections = await prisma.section.findMany({ where: { id: { in: requested }, venueId: gate.venueId }, select: { id: true } });

  await prisma.accessPoint.update({ where: { id: gate.id }, data: { sections: { set: sections } } });
  await prisma.auditLog.create({
    data: {
      actorType: "staff",
      actorId: staff.id,
      action: "access_point.sections",
      entity: "AccessPoint",
      entityId: gate.id,
      data: { sections: sections.map((s) => s.id) },
    },
  });
  revalidatePath(`/recintos/${gate.venueId}`);
  return { ok: true };
}

export async function deleteAccessPointAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
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
