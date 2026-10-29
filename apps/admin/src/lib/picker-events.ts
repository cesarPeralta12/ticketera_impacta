import { formatDateTime } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import type { PickerEvent } from "@/components/event-sessions-picker";

/** Eventos con venta y funciones por delante de la organización, para elegir qué vende un cajero o un promotor. */
export async function pickerEvents(organizationId: string, now = new Date()): Promise<(PickerEvent & { status: string })[]> {
  const events = await prisma.event.findMany({
    where: { organizationId, mode: "TICKETING", status: { not: "CANCELLED" }, sessions: { some: { cancelledAt: null, startsAt: { gt: new Date(now.getTime() - 12 * 3_600_000) } } } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      sessions: {
        where: { cancelledAt: null, startsAt: { gt: new Date(now.getTime() - 12 * 3_600_000) } },
        orderBy: { startsAt: "asc" },
        select: { id: true, startsAt: true, venue: { select: { timezone: true } } },
      },
    },
  });
  return events.map((e) => ({
    id: e.id,
    title: e.status === "PUBLISHED" ? e.title : `${e.title} (todavía no publicado)`,
    status: e.status,
    sessions: e.sessions.map((s) => ({ id: s.id, label: formatDateTime(s.startsAt, s.venue.timezone) })),
  }));
}
