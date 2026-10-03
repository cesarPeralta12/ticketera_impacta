import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { GuestQrSheet } from "@/components/guest-qr-sheet";
import { ROLES, requireStaff, visibleEvent } from "@/lib/session";

export const metadata: Metadata = { title: "QRs de invitados" };

type Props = { params: Promise<{ eventId: string; sessionId: string }> };

export default async function ClientPrintGuestsPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.client);
  const { eventId, sessionId } = await params;
  const event = await visibleEvent(staff, eventId);
  if (!event || event.mode !== "GUEST_LIST") notFound();
  const sheet = await GuestQrSheet({ eventId, sessionId, backHref: `/cliente/${eventId}/invitados/${sessionId}` });
  return sheet ?? notFound();
}
