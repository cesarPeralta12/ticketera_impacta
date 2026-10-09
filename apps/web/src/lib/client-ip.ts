import { headers } from "next/headers";

/** IP de quien hace la petición (detrás del proxy del servidor llega en x-forwarded-for). */
export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "desconocida";
}

export const TOO_MANY_ATTEMPTS = "Demasiados intentos. Espera unos minutos y vuelve a intentar.";
