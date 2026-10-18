"use server";

import { revalidatePath } from "next/cache";
import { DomainError, correctPresence, prisma, type PresenceCorrection } from "@ticketera/db";
import { type FormState } from "@/lib/forms";
import { requireEditor } from "@/lib/session";

/** Corrección manual de presencia de una entrada (afuera, adentro en una zona o "no ingresó"), con motivo. */
export async function correctPresenceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const ticket = await prisma.ticket.findFirst({
    where: { id: String(formData.get("ticketId") ?? ""), session: { event: { organizationId: staff.organization.id } } },
    select: { id: true, code: true },
  });
  if (!ticket) return { error: "Entrada no encontrada." };
  const action = (["OUT", "IN", "RESET"] as const).find((a) => a === formData.get("action")) as PresenceCorrection | undefined;
  if (!action) return { fieldErrors: { action: "Elige qué corregir." } };
  try {
    await correctPresence({
      ticketId: ticket.id,
      staffId: staff.id,
      action,
      zoneId: String(formData.get("zoneId") ?? "") || null,
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/entradas/${ticket.code}`);
  return { ok: true, message: "Corrección guardada." };
}
