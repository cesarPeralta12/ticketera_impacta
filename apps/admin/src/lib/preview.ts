import { PREVIEW_TOKEN_DAYS, signPreviewToken } from "@ticketera/core";
import { requireEnv } from "@ticketera/db";

/** Enlace a la página del evento como la ve el comprador (aunque siga en borrador). Vence en unos días. */
export async function buyerPreviewUrl(eventId: string): Promise<string> {
  const token = await signPreviewToken(eventId, requireEnv("TICKET_QR_SECRET"), new Date(Date.now() + PREVIEW_TOKEN_DAYS * 86_400_000));
  return `${requireEnv("WEB_URL").replace(/\/$/, "")}/vista-previa/${token}`;
}
