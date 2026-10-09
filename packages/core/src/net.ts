/**
 * Datos de red de una petición: IP real del cliente y descripción legible de su navegador o app.
 * Puras (sin Next ni base de datos) para poder probarlas.
 */

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

function validIp(value: string | undefined): string | null {
  const v = value?.trim().replace(/^\[|\]$/g, "");
  if (!v || v.length > 45) return null;
  return IPV4.test(v) || (v.includes(":") && IPV6.test(v)) ? v : null;
}

/**
 * IP del cliente detrás de `hops` proxies de confianza (Coolify/Traefik = 1; con Cloudflare delante = 2).
 *
 * Cada proxy AGREGA al final de `x-forwarded-for` la IP de quien le habló, así que lo que escribe el
 * cliente queda a la izquierda y se puede inventar: por eso se cuenta desde la derecha, saltando solo
 * los proxies propios, en vez de tomar el primer valor.
 */
export function clientIpFromHeaders(forwardedFor: string | null | undefined, realIp: string | null | undefined, hops = 1): string {
  const chain = (forwardedFor ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (chain.length > 0) {
    const fromRight = chain[Math.max(0, chain.length - Math.max(1, hops))];
    const ip = validIp(fromRight);
    if (ip) return ip;
  }
  return validIp(realIp ?? undefined) ?? "desconocida";
}

/** "Chrome en Windows", "Firefox en Android"… a partir del User-Agent. Sin dependencias: basta para el registro. */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Desconocido";
  if (/^dart\b/i.test(ua) || /impacta-puerta/i.test(ua)) return "App de puerta";
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Android/i.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/i.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : null;
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : /curl|wget|python|node|axios|postman/i.test(ua)
              ? "Script/herramienta"
              : null;
  if (browser && os) return `${browser} en ${os}`;
  return browser ?? os ?? "Desconocido";
}

/**
 * ¿La cabecera `Origin` de una petición es de este mismo sitio? Sin `Origin` (apps móviles, curl, navegación
 * normal con GET) no hay nada que comparar y se considera válida: quien la manda no es una página ajena.
 */
export function isAllowedOrigin(origin: string | null | undefined, allowedHosts: (string | null | undefined)[]): boolean {
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false; // "null" u otro valor raro: cross-origin sandbox o ataque
  }
  return allowedHosts.some((h) => h && h.toLowerCase() === host);
}
