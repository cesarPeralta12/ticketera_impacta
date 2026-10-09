/**
 * Enlaces por correo: confirmar el email y cambiar la contraseña (compradores y personal del panel).
 *
 * - El token se genera aleatorio y solo se guarda su hash.
 * - Sirve una sola vez y vence (24 h para confirmar el correo, 1 h para cambiar la contraseña).
 * - Pedir uno nuevo anula los anteriores; hay un tiempo mínimo entre pedidos y un máximo por hora,
 *   para que nadie use el sistema para llenar de correos a otra persona.
 * - "Olvidé mi contraseña" no revela si el email existe: quien llama muestra siempre el mismo mensaje.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../client";
import type { EmailTokenPurpose } from "../generated/prisma/client";
import { MIN_PASSWORD_LENGTH, hashPassword, passwordMatches } from "./accounts";

export const VERIFY_EMAIL_HOURS = 24;
export const RESET_PASSWORD_MINUTES = 60;
/** Tiempo mínimo entre dos correos del mismo tipo para la misma cuenta. */
export const EMAIL_COOLDOWN_SECONDS = 60;
export const MAX_EMAILS_PER_HOUR = 3;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type Owner = { customerId: string } | { staffUserId: string };

async function issueToken(
  purpose: EmailTokenPurpose,
  owner: Owner,
  ttlMs: number,
  now: Date,
): Promise<{ token: string } | { error: "TOO_SOON" }> {
  const where = { purpose, ...owner };
  const last = await prisma.emailToken.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && now.getTime() - last.createdAt.getTime() < EMAIL_COOLDOWN_SECONDS * 1000) return { error: "TOO_SOON" };
  const lastHour = await prisma.emailToken.count({ where: { ...where, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
  if (lastHour >= MAX_EMAILS_PER_HOUR) return { error: "TOO_SOON" };

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    // Un enlace nuevo anula los anteriores.
    prisma.emailToken.updateMany({ where: { ...where, usedAt: null }, data: { usedAt: now } }),
    prisma.emailToken.create({
      data: { purpose, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + ttlMs), ...owner },
    }),
  ]);
  return { token };
}

/** Usa el token (una sola vez). Devuelve de quién es, o null si no existe, ya se usó o venció. */
async function consumeToken(token: string, purpose: EmailTokenPurpose, now: Date) {
  const tokenHash = hashToken(token);
  const { count } = await prisma.emailToken.updateMany({
    where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (count !== 1) return null;
  return prisma.emailToken.findUniqueOrThrow({ where: { tokenHash }, select: { customerId: true, staffUserId: true } });
}

/** ¿El enlace todavía sirve? (para mostrar el formulario sin gastarlo). */
export async function isEmailTokenValid(token: string, purpose: EmailTokenPurpose, now = new Date()) {
  const row = await prisma.emailToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { purpose: true, usedAt: true, expiresAt: true },
  });
  return Boolean(row && row.purpose === purpose && !row.usedAt && row.expiresAt > now);
}

// ───────────────────────── Compradores ─────────────────────────

export type IssuedEmail = { status: "SENT"; token: string; email: string; name: string };

/** Pide el correo de confirmación de una cuenta de comprador. */
export async function requestCustomerEmailVerification(
  customerId: string,
  now = new Date(),
): Promise<IssuedEmail | { status: "ALREADY_VERIFIED" | "TOO_SOON" | "NOT_FOUND" }> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { email: true, name: true, emailVerified: true } });
  if (!customer) return { status: "NOT_FOUND" };
  if (customer.emailVerified) return { status: "ALREADY_VERIFIED" };
  const issued = await issueToken("VERIFY_EMAIL", { customerId }, VERIFY_EMAIL_HOURS * 3_600_000, now);
  if ("error" in issued) return { status: "TOO_SOON" };
  return { status: "SENT", token: issued.token, email: customer.email, name: customer.name };
}

export async function confirmCustomerEmail(token: string, now = new Date()): Promise<{ ok: true; email: string } | { ok: false }> {
  const owner = await consumeToken(token, "VERIFY_EMAIL", now);
  if (!owner?.customerId) return { ok: false };
  const customer = await prisma.customer.update({ where: { id: owner.customerId }, data: { emailVerified: true }, select: { email: true } });
  return { ok: true, email: customer.email };
}

/** "Olvidé mi contraseña" de un comprador. IGNORED = no existe o pidió demasiados: no se le dice a quien pide. */
export async function requestCustomerPasswordReset(email: string, now = new Date()): Promise<IssuedEmail | { status: "IGNORED" }> {
  const customer = await prisma.customer.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, name: true },
  });
  if (!customer) return { status: "IGNORED" };
  const issued = await issueToken("RESET_PASSWORD", { customerId: customer.id }, RESET_PASSWORD_MINUTES * 60_000, now);
  if ("error" in issued) return { status: "IGNORED" };
  return { status: "SENT", token: issued.token, email: customer.email, name: customer.name };
}

/** Elige una contraseña nueva con el enlace del correo. Entrar por ese enlace también confirma el email. */
export async function resetCustomerPassword(token: string, newPassword: string, now = new Date()) {
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false as const, reason: "WEAK" as const };
  const owner = await consumeToken(token, "RESET_PASSWORD", now);
  if (!owner?.customerId) return { ok: false as const, reason: "INVALID_LINK" as const };
  const customer = await prisma.customer.update({
    where: { id: owner.customerId },
    data: { passwordHash: await hashPassword(newPassword), emailVerified: true, sessionVersion: { increment: 1 } },
    select: { email: true, name: true },
  });
  return { ok: true as const, ...customer };
}

/** Cambio de contraseña estando dentro de la cuenta: pide la actual. */
export async function changeCustomerPassword(customerId: string, current: string, next: string) {
  if (next.length < MIN_PASSWORD_LENGTH) return { ok: false as const, reason: "WEAK" as const };
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { passwordHash: true, email: true, name: true },
  });
  if (!customer || !(await passwordMatches(current, customer.passwordHash))) return { ok: false as const, reason: "WRONG_PASSWORD" as const };
  await prisma.customer.update({
    where: { id: customerId },
    data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } },
  });
  return { ok: true as const, email: customer.email, name: customer.name };
}

// ───────────────────────── Personal del panel ─────────────────────────

/** "Olvidé mi contraseña" del personal (organizadores, cajeros, porteros). Solo cuentas activas. */
export async function requestStaffPasswordReset(email: string, now = new Date()): Promise<IssuedEmail | { status: "IGNORED" }> {
  const staff = await prisma.staffUser.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, name: true, active: true },
  });
  if (!staff || !staff.active) return { status: "IGNORED" };
  const issued = await issueToken("RESET_PASSWORD", { staffUserId: staff.id }, RESET_PASSWORD_MINUTES * 60_000, now);
  if ("error" in issued) return { status: "IGNORED" };
  return { status: "SENT", token: issued.token, email: staff.email, name: staff.name };
}

export async function resetStaffPassword(token: string, newPassword: string, now = new Date()) {
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false as const, reason: "WEAK" as const };
  const owner = await consumeToken(token, "RESET_PASSWORD", now);
  if (!owner?.staffUserId) return { ok: false as const, reason: "INVALID_LINK" as const };
  const staff = await prisma.staffUser.update({
    where: { id: owner.staffUserId },
    // Con una contraseña elegida por la persona deja de ser temporal.
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, emailVerified: true, sessionVersion: { increment: 1 } },
    select: { email: true, name: true },
  });
  // Un teléfono robado no debe seguir dentro: al cambiar la contraseña se cierran las sesiones de la app.
  await prisma.deviceToken.updateMany({ where: { userId: owner.staffUserId, revokedAt: null }, data: { revokedAt: now } });
  return { ok: true as const, ...staff };
}
