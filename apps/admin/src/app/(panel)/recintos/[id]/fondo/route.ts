import { prisma } from "@ticketera/db";
import { ROLES, can, currentStaff } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

/**
 * Imagen del plano real de un recinto, para calcar en los editores del panel. Va aislada (sandbox, sin scripts):
 * un SVG subido no puede ejecutar nada aunque se abra directo.
 */
export async function GET(_req: Request, { params }: Props) {
  const staff = await currentStaff();
  if (!staff || !can(staff, ROLES.manage)) return new Response("Sin permiso.", { status: 403 });
  const image = await prisma.venuePlanImage.findFirst({
    where: { venueId: (await params).id, venue: { organizationId: staff.organization.id } },
    select: { data: true, mimeType: true },
  });
  if (!image) return new Response("Sin plano de fondo.", { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
