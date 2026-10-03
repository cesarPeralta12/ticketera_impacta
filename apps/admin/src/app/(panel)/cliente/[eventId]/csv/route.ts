import { attendeesCsvResponse } from "@/lib/report-csv";
import { currentStaff, visibleEvent } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: "Sin sesión." }, { status: 401 });
  const event = await visibleEvent(staff, (await params).eventId);
  if (!event) return Response.json({ error: "Evento no disponible." }, { status: 404 });
  return attendeesCsvResponse(event.id, event.slug);
}
