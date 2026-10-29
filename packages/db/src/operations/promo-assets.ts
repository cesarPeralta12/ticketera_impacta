/**
 * Material promocional del evento (una imagen o un video por evento): lo sube el organizador y los promotores con el
 * evento asignado lo descargan en su calidad original. Dura hasta 30 días después de la última función; pasada esa fecha ya no se entrega y se borra.
 */
import { PROMO_ASSET_ACCEPT_MESSAGE, PROMO_ASSET_MAX_BYTES, promoAssetExpiry, safePromoAssetName } from "@ticketera/core";
import { prisma } from "../client";
import { DomainError, audit } from "./shared";

/** Hasta cuándo está disponible el material de un evento (sin funciones: no vence hasta que haya una). */
export async function promoAssetsExpiry(eventId: string): Promise<Date | null> {
  const sessions = await prisma.eventSession.findMany({ where: { eventId }, select: { startsAt: true, endsAt: true } });
  if (sessions.length === 0) return null;
  const last = Math.max(...sessions.map((s) => (s.endsAt ?? s.startsAt).getTime()));
  return promoAssetExpiry(new Date(last));
}

const META = { id: true, eventId: true, fileName: true, mimeType: true, byteSize: true, width: true, height: true, createdAt: true } as const;

export type PromoAssetMeta = { id: string; eventId: string; fileName: string; mimeType: string; byteSize: number; width: number | null; height: number | null; createdAt: Date; hasThumb: boolean };

async function withThumbFlag(rows: { id: string }[], eventIds: string[]) {
  const withThumb = await prisma.eventPromoAsset.findMany({ where: { eventId: { in: eventIds }, thumb: { not: null } }, select: { id: true } });
  return new Set(withThumb.map((r) => r.id));
}

/** Material de un evento (sin los bytes). */
export async function listPromoAssets(organizationId: string, eventId: string): Promise<PromoAssetMeta[]> {
  const rows = await prisma.eventPromoAsset.findMany({ where: { eventId, event: { organizationId } }, orderBy: { createdAt: "asc" }, select: META });
  const thumbs = await withThumbFlag(rows, [eventId]);
  return rows.map((r) => ({ ...r, hasThumb: thumbs.has(r.id) }));
}

export type NewPromoAsset = {
  fileName: string;
  mimeType: string;
  data: Uint8Array<ArrayBuffer>;
  width?: number | null;
  height?: number | null;
  thumb?: Uint8Array<ArrayBuffer> | null;
};

export async function addPromoAsset(organizationId: string, eventId: string, input: NewPromoAsset, actorId: string) {
  if (input.data.length === 0) throw new DomainError("INVALID_ITEMS", "El archivo está vacío.");
  if (input.data.length > PROMO_ASSET_MAX_BYTES) throw new DomainError("INVALID_ITEMS", "El archivo pesa más de 25 MB.");
  if (!/^(image|video)\//.test(input.mimeType)) throw new DomainError("INVALID_ITEMS", PROMO_ASSET_ACCEPT_MESSAGE);
  const event = await prisma.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } });
  if (!event) throw new DomainError("NOT_FOUND", "Evento no encontrado.");
  // Un solo archivo por evento: el nuevo reemplaza al anterior.
  const asset = await prisma.$transaction(async (tx) => {
    await tx.eventPromoAsset.deleteMany({ where: { eventId } });
    return tx.eventPromoAsset.create({
    data: {
      eventId,
      fileName: safePromoAssetName(input.fileName),
      mimeType: input.mimeType,
      byteSize: input.data.length,
      width: input.width ?? null,
      height: input.height ?? null,
      thumb: input.thumb ?? null,
      data: input.data,
      uploadedById: actorId,
    },
    select: META,
    });
  });
  await audit(prisma, { actorType: "staff", actorId, action: "event.promo_asset_add", entity: "EventPromoAsset", entityId: asset.id, data: { eventId, bytes: asset.byteSize, mimeType: asset.mimeType } });
  return asset;
}

export async function deletePromoAsset(organizationId: string, assetId: string, actorId: string) {
  const { count } = await prisma.eventPromoAsset.deleteMany({ where: { id: assetId, event: { organizationId } } });
  if (count !== 1) throw new DomainError("NOT_FOUND", "Archivo no encontrado.");
  await audit(prisma, { actorType: "staff", actorId, action: "event.promo_asset_delete", entity: "EventPromoAsset", entityId: assetId });
}

/**
 * El archivo, si esa persona puede bajarlo: un promotor activo con el evento asignado, o quien administra la
 * organización (`asManager`). Vencido o sin permiso: null (el llamador responde 404).
 */
export async function getPromoAssetFile(
  assetId: string,
  who: { organizationId: string; userId: string; asManager: boolean },
  now = new Date(),
  part: "data" | "thumb" = "data",
) {
  const asset = await prisma.eventPromoAsset.findFirst({
    where: {
      id: assetId,
      event: {
        organizationId: who.organizationId,
        ...(who.asManager ? {} : { promoters: { some: { userId: who.userId, user: { active: true } } } }),
      },
    },
    select: { fileName: true, mimeType: true, eventId: true, thumb: part === "thumb", data: part === "data" },
  });
  const bytes = asset ? (part === "thumb" ? asset.thumb : asset.data) : null;
  if (!asset || !bytes) return null;
  const expires = await promoAssetsExpiry(asset.eventId);
  if (expires && expires <= now) return null;
  return { fileName: asset.fileName, mimeType: part === "thumb" ? "image/jpeg" : asset.mimeType, data: bytes };
}

/** Material de los eventos asignados a un promotor (sin bytes), con la fecha en que deja de estar disponible. */
export async function promoAssetsForPromoter(userId: string, organizationId: string, now = new Date()) {
  const rows = await prisma.eventPromoAsset.findMany({
    where: { event: { organizationId, promoters: { some: { userId } } } },
    orderBy: { createdAt: "asc" },
    select: META,
  });
  if (rows.length === 0) return new Map<string, { expiresAt: Date | null; assets: PromoAssetMeta[] }>();
  const thumbs = await withThumbFlag(rows, [...new Set(rows.map((r) => r.eventId))]);
  const byEvent = new Map<string, { expiresAt: Date | null; assets: PromoAssetMeta[] }>();
  for (const r of rows) {
    const entry = byEvent.get(r.eventId) ?? { expiresAt: await promoAssetsExpiry(r.eventId), assets: [] };
    entry.assets.push({ ...r, hasThumb: thumbs.has(r.id) });
    byEvent.set(r.eventId, entry);
  }
  for (const [id, entry] of byEvent) if (entry.expiresAt && entry.expiresAt <= now) byEvent.delete(id);
  return byEvent;
}

/** Borra el material de los eventos que terminaron hace más de 30 días. Devuelve cuántos archivos borró. */
export async function purgeExpiredPromoAssets(now = new Date()): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "EventPromoAsset" a
    WHERE (SELECT max(COALESCE(s."endsAt", s."startsAt")) FROM "EventSession" s WHERE s."eventId" = a."eventId") + interval '30 days' < ${now}`;
}
