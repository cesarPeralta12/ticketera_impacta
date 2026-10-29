/**
 * Material promocional del evento: UNA imagen o UN video por evento que los promotores descargan tal cual lo subió el
 * organizador (no se recomprime ni se convierte). Se borra a los 30 días de terminado el evento.
 */
export const PROMO_ASSET_MAX_BYTES = 25 * 1024 * 1024;
/** Días que el material sigue disponible después de la última función del evento. */
export const PROMO_ASSET_RETENTION_DAYS = 30;
/** Miniatura (JPG que arma el navegador solo para mostrar una vista previa). */
export const PROMO_ASSET_THUMB_MAX_BYTES = 120_000;

const DAY_MS = 86_400_000;

/** Hasta cuándo está disponible el material: 30 días después de que termina la última función. */
export function promoAssetExpiry(lastSessionEnd: Date): Date {
  return new Date(lastSessionEnd.getTime() + PROMO_ASSET_RETENTION_DAYS * DAY_MS);
}

/** Nombre seguro para guardar y para la cabecera de descarga (sin rutas ni caracteres raros). */
export function safePromoAssetName(raw: string): string {
  const base = raw.split(/[\/]/).pop() ?? "";
  const clean = base.replace(/[^\p{L}\p{N}._ ()-]/gu, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean || "material";
}

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

/**
 * Tipo real del archivo por sus primeros bytes (no por la extensión): imagen (JPG, PNG, WebP, GIF) o video (MP4, WebM,
 * MOV). Cualquier otra cosa es null y no se acepta.
 */
export function promoAssetType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp") return ascii(bytes, 8, 10) === "qt" ? "video/quicktime" : "video/mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return null;
}

export const PROMO_ASSET_ACCEPT_MESSAGE = "Sube una imagen (JPG, PNG, WebP o GIF) o un video (MP4, WebM o MOV).";

export const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
