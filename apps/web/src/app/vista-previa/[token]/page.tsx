import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { verifyPreviewToken } from "@ticketera/core";
import { requireEnv } from "@ticketera/db";
import { EventView } from "@/components/event-view";
import { getEventForPreview } from "@/lib/events";

export const metadata: Metadata = { title: "Vista previa", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

/**
 * Vista previa de un evento desde el panel (aunque siga en borrador): el enlace va firmado y vence. Es la misma página
 * que verá el comprador, con un aviso arriba y sin poder comprar.
 */
export default async function PreviewPage({ params }: Props) {
  await connection();
  const eventId = await verifyPreviewToken(decodeURIComponent((await params).token), requireEnv("TICKET_QR_SECRET"));
  const event = eventId ? await getEventForPreview(eventId) : null;
  if (!event) notFound();
  return <EventView event={event} preview />;
}
