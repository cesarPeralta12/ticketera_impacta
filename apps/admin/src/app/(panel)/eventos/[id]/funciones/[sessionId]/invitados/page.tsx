import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { GuestsView } from "@/components/guests-view";
import { ROLES, requireStaff, visibleEvent } from "@/lib/session";

export const metadata: Metadata = { title: "Invitados" };

type Props = {
  params: Promise<{ id: string; sessionId: string }>;
  searchParams: Promise<{ q?: string }>;
};

export default async function GuestsPage({ params, searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id, sessionId } = await params;
  if (!(await visibleEvent(staff, id))) notFound();
  const view = await GuestsView({
    eventId: id,
    sessionId,
    q: (await searchParams).q?.trim() ?? "",
    basePath: `/eventos/${id}/funciones/${sessionId}/invitados`,
    backHref: `/eventos/${id}/funciones/${sessionId}`,
  });
  return view ?? notFound();
}
