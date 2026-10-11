import { headers } from "next/headers";
import { clientIpFromHeaders } from "@ticketera/core";

/** Proxies propios delante de la app (Coolify/Traefik = 1; con Cloudflare delante = 2). */
export const TRUSTED_PROXY_HOPS = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);

/** IP de quien hace la petición: la que vio nuestro proxy, no la que escribe el cliente en x-forwarded-for. */
export function ipFromHeaders(h: Pick<Headers, "get">) {
  return clientIpFromHeaders(h.get("x-forwarded-for"), h.get("x-real-ip"), TRUSTED_PROXY_HOPS);
}

export async function clientIp() {
  return ipFromHeaders(await headers());
}

/** IP y navegador de quien hace la petición (para el registro de seguridad). */
export async function requestContext() {
  const h = await headers();
  return { ip: ipFromHeaders(h), userAgent: h.get("user-agent")?.slice(0, 300) ?? undefined };
}

export const TOO_MANY_ATTEMPTS = "Demasiados intentos. Espera unos minutos y vuelve a intentar.";
