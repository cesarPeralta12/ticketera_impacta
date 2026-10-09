/**
 * Límite de intentos (rate limiting) en Postgres: sirve igual con varios servidores.
 *
 * Cada intento se anota con una clave ("login:ip:1.2.3.4", "login:fail:ana@correo.com"…). Se permite
 * mientras haya menos de `limit` intentos en los últimos `windowSeconds`. Para no bloquear a quien sí
 * conoce su contraseña por culpa de otros, el límite por cuenta cuenta solo los fallos
 * (`isLimited` + `recordHit`), y el de IP cuenta todos los intentos (`hit`).
 */
import { prisma } from "../client";

export type Limit = { limit: number; windowSeconds: number };

const since = (now: Date, windowSeconds: number) => new Date(now.getTime() - windowSeconds * 1000);

/** ¿Ya se alcanzó el límite para esta clave? (no anota nada) */
export async function isLimited(key: string, { limit, windowSeconds }: Limit, now = new Date()) {
  const count = await prisma.rateLimitHit.count({ where: { key, createdAt: { gt: since(now, windowSeconds) } } });
  return count >= limit;
}

/** Anota un intento. */
export async function recordHit(key: string, now = new Date()) {
  await prisma.rateLimitHit.create({ data: { key, createdAt: now } });
  // Limpieza ocasional: lo de hace más de un día ya no cuenta para ningún límite.
  if (Math.random() < 0.02) {
    await prisma.rateLimitHit.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } } });
  }
}

/**
 * Anota el intento si todavía hay cupo. Devuelve false si ya se pasó el límite (y no anota):
 * quien llama rechaza la operación.
 */
export async function hit(key: string, limit: Limit, now = new Date()): Promise<boolean> {
  if (await isLimited(key, limit, now)) return false;
  await recordHit(key, now);
  return true;
}

/** Límites de la plataforma, en un solo lugar para ajustarlos. */
export const LIMITS = {
  /** Intentos de ingresar por IP. */
  loginByIp: { limit: 20, windowSeconds: 10 * 60 },
  /** Contraseñas incorrectas por cuenta: al llegar, se bloquea el ingreso un rato. */
  loginFailuresByAccount: { limit: 6, windowSeconds: 15 * 60 },
  /** Cuentas nuevas por IP. */
  registerByIp: { limit: 5, windowSeconds: 60 * 60 },
  /** "Olvidé mi contraseña" por IP. */
  forgotByIp: { limit: 10, windowSeconds: 60 * 60 },
  /** Reservas de entradas por cuenta (evita acaparar butacas creando órdenes sin pagar). */
  ordersByAccount: { limit: 8, windowSeconds: 10 * 60 },
} as const satisfies Record<string, Limit>;
