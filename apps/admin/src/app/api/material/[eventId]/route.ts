import { PROMO_ASSET_ACCEPT_MESSAGE, PROMO_ASSET_MAX_BYTES, PROMO_ASSET_THUMB_MAX_BYTES, isJpeg, promoAssetType } from "@ticketera/core";
import { DomainError, addPromoAsset, purgeExpiredPromoAssets } from "@ticketera/db";
import { ROLES, can, currentStaff } from "@/lib/session";

type Props = { params: Promise<{ eventId: string }> };

const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Sube el material promocional del evento (una imagen o un video; reemplaza al anterior), tal cual (sin recomprimir). Va por una ruta y no por una server
 * action porque pesa hasta 25 MB y las acciones del panel aceptan solo 1 MB. La miniatura (JPG chico que arma el
 * navegador) es solo la vista previa; lo que descargan los promotores son los bytes originales de `file`.
 */
export async function POST(req: Request, { params }: Props) {
  const staff = await currentStaff();
  if (!staff || !can(staff, ROLES.manage)) return json({ error: "Sin permiso." }, 403);
  if (staff.readOnly) return json({ error: "Tu cuenta es de solo lectura." }, 403);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return json({ error: "Elige un archivo." }, 400);
  if (file.size > PROMO_ASSET_MAX_BYTES) return json({ error: "El archivo pesa más de 25 MB." }, 413);

  const data = new Uint8Array(await file.arrayBuffer());
  // Si el cuerpo llegó cortado (límite del servidor), no se guarda un archivo roto.
  if (data.length !== file.size) return json({ error: "El archivo llegó incompleto: vuelve a intentarlo." }, 400);

  const mimeType = promoAssetType(data);
  if (!mimeType) return json({ error: PROMO_ASSET_ACCEPT_MESSAGE }, 400);

  const thumbFile = form?.get("thumb");
  let thumb: Uint8Array<ArrayBuffer> | null = null;
  if (thumbFile instanceof File && thumbFile.size > 0 && thumbFile.size <= PROMO_ASSET_THUMB_MAX_BYTES) {
    const bytes = new Uint8Array(await thumbFile.arrayBuffer());
    if (isJpeg(bytes)) thumb = bytes;
  }
  const dim = (key: string) => {
    const n = Number(form?.get(key));
    return Number.isInteger(n) && n > 0 && n < 100_000 ? n : null;
  };

  try {
    const { eventId } = await params;
    const asset = await addPromoAsset(
      staff.organization.id,
      eventId,
      { fileName: file.name, mimeType, data, thumb, width: dim("width"), height: dim("height") },
      staff.id,
    );
    // Aprovecha la subida para borrar el material de eventos que terminaron hace más de 30 días.
    await purgeExpiredPromoAssets().catch(() => 0);
    return json({ id: asset.id });
  } catch (error) {
    if (error instanceof DomainError) return json({ error: error.message }, error.code === "NOT_FOUND" ? 404 : 400);
    throw error;
  }
}
