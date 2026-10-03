import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { GuestQrSheet } from "@/components/guest-qr-sheet";
import { ROLES, requireStaff, visibleEvent } from "@/lib/session";

export const metadata: Metadata = { title: "QRs de invitados" };

type Props = { params: Promise<{ id: string; sessionId: string }> };

export default async function PrintGuestsPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id, sessionId } = await params;
  if (!(await visibleEvent(staff, id))) notFound();
  const sheet = await GuestQrSheet({ eventId: id, sessionId, backHref: `/eventos/${id}/funciones/${sessionId}/invitados` });
  return sheet ?? notFound();
}
