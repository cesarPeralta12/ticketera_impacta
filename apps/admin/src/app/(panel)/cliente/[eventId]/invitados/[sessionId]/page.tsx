import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { GuestsView } from "@/components/guests-view";
import { ROLES, requireStaff, visibleEvent } from "@/lib/session";

export const metadata: Metadata = { title: "Invitados" };

type Props = {
  params: Promise<{ eventId: string; sessionId: string }>;
  searchParams: Promise<{ q?: string }>;
};

/** El cliente carga y administra su lista de invitados mientras su espacio esté abierto. */
export default async function ClientGuestsPage({ params, searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.client);
  const { eventId, sessionId } = await params;
  const event = await visibleEvent(staff, eventId);
  if (!event || event.mode !== "GUEST_LIST") notFound();
  const view = await GuestsView({
    eventId,
    sessionId,
    q: (await searchParams).q?.trim() ?? "",
    basePath: `/cliente/${eventId}/invitados/${sessionId}`,
    backHref: `/cliente/${eventId}`,
  });
  return view ?? notFound();
}
