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
