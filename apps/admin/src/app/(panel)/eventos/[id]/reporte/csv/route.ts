import { prisma } from "@ticketera/db";
import { attendeesCsvResponse } from "@/lib/report-csv";
import { ROLES, can, currentStaff } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff || !can(staff, ROLES.manage)) return Response.json({ error: "Sin permiso." }, { status: 403 });
  const event = await prisma.event.findFirst({
    where: { id: (await params).id, organizationId: staff.organization.id },
    select: { id: true, slug: true },
  });
  if (!event) return Response.json({ error: "Evento no encontrado." }, { status: 404 });
  return attendeesCsvResponse(event.id, event.slug);
}
