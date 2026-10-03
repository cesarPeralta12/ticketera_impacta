"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zonedDateTimeToUtc } from "@ticketera/core";
import { defaultClientAccessUntil, prisma } from "@ticketera/db";
import { formObject, zodErrors, type FormState } from "@/lib/forms";
import { ROLES, requireStaff } from "@/lib/session";

const clientSchema = z.object({
  name: z.string({ error: "Ingresa el nombre del cliente." }).min(2).max(120),
  taxId: z.string().max(30).optional(),
  contactEmail: z.string().toLowerCase().pipe(z.email("Email inválido.")).optional(),
});

export async function createClientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const parsed = clientSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const exists = await prisma.client.findFirst({
    where: { organizationId: staff.organization.id, name: parsed.data.name },
  });
  if (exists) return { fieldErrors: { name: "Ya existe un cliente con ese nombre." } };
  const client = await prisma.client.create({ data: { organizationId: staff.organization.id, ...parsed.data } });
  await prisma.auditLog.create({
    data: { actorType: "staff", actorId: staff.id, action: "client.create", entity: "Client", entityId: client.id },
  });
  revalidatePath("/clientes");
  return { ok: true };
}

/**
 * Habilita o cierra el espacio temporal del cliente para un evento. Si no se indica hasta
 * cuándo, queda abierto hasta 24 h después de la última función.
 */
export async function updateClientAccessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const event = await prisma.event.findFirst({
    where: { id: String(formData.get("eventId")), organizationId: staff.organization.id },
    include: { sessions: { take: 1, include: { venue: { select: { timezone: true } } } } },
  });
  if (!event) return { error: "Evento no encontrado." };
  if (!event.clientId) return { error: "Primero asigna un cliente al evento (en Editar datos del evento)." };

  const enabled = formData.get("enabled") === "on";
  const untilRaw = String(formData.get("until") ?? "").trim();
  let until: Date | null = null;
  if (enabled) {
    if (untilRaw) {
      try {
        until = zonedDateTimeToUtc(untilRaw, event.sessions[0]?.venue.timezone ?? "America/La_Paz");
      } catch {
        return { fieldErrors: { until: "Fecha inválida." } };
      }
    } else {
      until = await defaultClientAccessUntil(event.id);
    }
  }

  await prisma.event.update({
    where: { id: event.id },
    data: { clientAccessEnabled: enabled, clientAccessUntil: until },
  });
  await prisma.auditLog.create({
    data: {
      actorType: "staff",
      actorId: staff.id,
      action: enabled ? "client_access.enable" : "client_access.disable",
      entity: "Event",
      entityId: event.id,
      data: { until: until?.toISOString() ?? null },
    },
  });
  revalidatePath(`/eventos/${event.id}`);
  return { ok: true };
}
