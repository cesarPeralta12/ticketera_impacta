/**
 * Foto del evento subida desde el panel: el navegador la achica antes de mandarla (lado mayor EVENT_IMAGE_MAX_SIDE),
 * así siempre entra bajo el tope de lo que acepta el servidor.
 */
export const EVENT_IMAGE_MAX_SIDE = 1600;
export const EVENT_IMAGE_MAX_BYTES = 900_000;

/** Dirección pública (en el sitio) de una foto de evento subida. */
export const eventImagePath = (id: string) => `/imagenes/${id}`;

/** Tipo real de la foto por sus primeros bytes (no por la extensión): JPG, PNG o WebP; null si no es una de esas. */
export function eventImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Al buscar una foto en Google o Bing es fácil copiar el enlace de la página de
 * resultados (google.com/imgres?…) en vez del de la imagen. Esa página no es una imagen,
 * pero trae la dirección real en un parámetro: la extraemos.
 */
export function normalizeImageUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  const host = url.hostname.replace(/^www\./, "");
  const candidates: (string | null)[] = [];
  if (/^google\.[a-z.]+$/.test(host) && url.pathname === "/imgres") candidates.push(url.searchParams.get("imgurl"));
  if (host === "bing.com" && url.pathname.startsWith("/images")) candidates.push(url.searchParams.get("mediaurl"));

  for (const candidate of candidates) {
    if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
  }
  return url.toString();
}
