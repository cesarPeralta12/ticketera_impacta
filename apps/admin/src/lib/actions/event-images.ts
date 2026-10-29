"use server";

import { EVENT_IMAGE_MAX_BYTES, eventImagePath, eventImageType } from "@ticketera/core";
import { prisma, requireEnv } from "@ticketera/db";
import { logAudit } from "@/lib/audit";
import { requireEditor } from "@/lib/session";

/**
 * Sube la foto de un evento (el navegador ya la achicó) y devuelve su dirección en el sitio para el campo «Imagen».
 * Se guarda aparte del evento: así también sirve al crear uno nuevo, antes de que exista.
 */
export async function uploadEventImageAction(formData: FormData): Promise<{ url: string } | { error: string }> {
  const staff = await requireEditor();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { error: "Elige una foto." };
  if (file.size > EVENT_IMAGE_MAX_BYTES) return { error: "La foto es muy pesada: prueba con otra." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = eventImageType(bytes);
  if (!mimeType) return { error: "Sube una foto JPG, PNG o WebP." };
  const image = await prisma.eventImage.create({ data: { organizationId: staff.organization.id, mimeType, data: bytes }, select: { id: true } });
  await logAudit({ actorType: "staff", actorId: staff.id, action: "event.image_upload", entity: "EventImage", entityId: image.id, data: { mimeType, bytes: bytes.length } });
  return { url: `${requireEnv("WEB_URL").replace(/\/$/, "")}${eventImagePath(image.id)}` };
}
