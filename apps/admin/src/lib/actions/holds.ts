"use server";

import { revalidatePath } from "next/cache";
import { DomainError, holdSeats, prisma, releaseSeatHold, unholdSeats, updateSeatHold } from "@ticketera/db";
import { type FormState } from "@/lib/forms";
import { requireEditor, type Staff } from "@/lib/session";

async function ownSession(staff: Staff, sessionId: string) {
  return prisma.eventSession.findFirst({ where: { id: sessionId, event: { organizationId: staff.organization.id } }, select: { id: true, eventId: true } });
}

const path = (s: { id: string; eventId: string }) => `/eventos/${s.eventId}/funciones/${s.id}/retenciones`;
const seatIdsOf = (formData: FormData) => String(formData.get("seatIds") ?? "").split(",").filter(Boolean);
const color = (formData: FormData) => (/^#[0-9a-fA-F]{6}$/.test(String(formData.get("color"))) ? String(formData.get("color")) : "#7C3AED");

async function run(staff: Staff, sessionId: string, work: (session: { id: string; eventId: string }) => Promise<string>): Promise<FormState> {
  const session = await ownSession(staff, sessionId);
  if (!session) return { error: "Función no encontrada." };
  try {
    const message = await work(session);
    revalidatePath(path(session));
    return { ok: true, message };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

/** Nueva retención con las butacas elegidas, o suma butacas a una existente. */
export async function holdSeatsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const seatIds = seatIdsOf(formData);
  const holdId = String(formData.get("holdId") ?? "") || undefined;
  return run(staff, String(formData.get("sessionId")), async (session) => {
    await holdSeats({
      sessionId: session.id,
      staffId: staff.id,
      seatIds,
      holdId,
      name: String(formData.get("name") ?? ""),
      color: color(formData),
      code: String(formData.get("code") ?? ""),
    });
    return `${seatIds.length} butaca(s) apartada(s).`;
  });
}

/** Saca las butacas elegidas de sus retenciones: vuelven a la venta. */
export async function unholdSeatsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  return run(staff, String(formData.get("sessionId")), async (session) => {
    const count = await unholdSeats({ sessionId: session.id, staffId: staff.id, seatIds: seatIdsOf(formData) });
    return `${count} butaca(s) volvieron a la venta.`;
  });
}

export async function updateHoldAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  return run(staff, String(formData.get("sessionId")), async (session) => {
    const hold = await prisma.seatHold.findFirst({ where: { id: String(formData.get("holdId")), sessionId: session.id } });
    if (!hold) throw new DomainError("NOT_FOUND", "Retención no encontrada.");
    await updateSeatHold({ holdId: hold.id, staffId: staff.id, name: String(formData.get("name") ?? ""), color: color(formData), code: String(formData.get("code") ?? "") });
    return "Guardado.";
  });
}

/** Libera una retención entera: sus butacas vuelven a la venta. */
export async function releaseHoldAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  return run(staff, String(formData.get("sessionId")), async (session) => {
    const hold = await prisma.seatHold.findFirst({ where: { id: String(formData.get("holdId")), sessionId: session.id } });
    if (!hold) throw new DomainError("NOT_FOUND", "Retención no encontrada.");
    const seats = await releaseSeatHold({ holdId: hold.id, staffId: staff.id });
    return `"${hold.name}" liberada: ${seats} butaca(s) volvieron a la venta.`;
  });
}
