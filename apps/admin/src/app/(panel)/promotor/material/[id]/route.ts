import { getPromoAssetFile } from "@ticketera/db";
import { ROLES, can, currentStaff } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

/**
 * Descarga el material promocional de un evento, en su calidad original: son exactamente los bytes que subió el
 * organizador. Lo puede bajar el promotor que tiene ese evento asignado y quien administra la organización.
 * `?miniatura=1` entrega solo la vista previa. Nunca se muestra dentro de la página: siempre es una descarga.
 */
export async function GET(req: Request, { params }: Props) {
  const staff = await currentStaff();
  const asManager = staff ? can(staff, ROLES.manage) : false;
  if (!staff || (!asManager && staff.role !== "PROMOTER")) return new Response("Sin permiso.", { status: 403 });
  const thumb = new URL(req.url).searchParams.get("miniatura") === "1";
  const file = await getPromoAssetFile(
    (await params).id,
    { organizationId: staff.organization.id, userId: staff.id, asManager },
    new Date(),
    thumb ? "thumb" : "data",
  );
  if (!file) return new Response("Archivo no disponible (no es de tus eventos o ya venció).", { status: 404 });
  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.data.length),
      "Content-Disposition": thumb ? "inline" : `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Content-Security-Policy": "default-src 'none'; img-src data:; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
