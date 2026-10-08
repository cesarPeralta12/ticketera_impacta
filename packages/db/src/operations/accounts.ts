/**
 * Cuentas de compradores (sitio público) y de staff (panel). Son tablas separadas:
 * una cuenta de comprador nunca puede entrar al panel, ni al revés.
 */
import bcrypt from "bcryptjs";
import { MIN_PASSWORD_LENGTH, isValidDocument, normalizeDocument } from "@ticketera/core";
import type { StaffRole } from "../generated/prisma/client";
import { prisma } from "../client";
import { isUniqueViolation } from "./shared";

const BCRYPT_COST = 11;
export { MIN_PASSWORD_LENGTH };

/** Hash de relleno para que "usuario inexistente" tarde lo mismo que "contraseña incorrecta". */
let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

async function passwordMatches(password: string, hash: string | undefined): Promise<boolean> {
  dummyHash ??= hashPassword("contraseña-de-relleno");
  const ok = await bcrypt.compare(password, hash ?? (await dummyHash));
  return ok && hash !== undefined;
}

export async function verifyCustomerCredentials(email: string, password: string) {
  const customer = await prisma.customer.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!(await passwordMatches(password, customer?.passwordHash))) return null;
  return customer;
}

/**
 * Crea la cuenta de un comprador. El carnet es obligatorio y único (una persona, una cuenta).
 * Devuelve la causa si no se pudo: el email o el carnet ya tienen cuenta.
 */
export async function registerCustomer(input: {
  name: string;
  email: string;
  password: string;
  document: string;
  phone?: string;
}): Promise<{ customer: Awaited<ReturnType<typeof prisma.customer.create>> } | { error: "EMAIL_TAKEN" | "DOCUMENT_TAKEN" | "DOCUMENT_INVALID" }> {
  const documentId = normalizeDocument(input.document);
  if (!isValidDocument(documentId)) return { error: "DOCUMENT_INVALID" };
  const email = input.email.trim().toLowerCase();
  if (await prisma.customer.findUnique({ where: { email }, select: { id: true } })) return { error: "EMAIL_TAKEN" };
  if (await prisma.customer.findUnique({ where: { documentId }, select: { id: true } })) return { error: "DOCUMENT_TAKEN" };
  try {
    const customer = await prisma.customer.create({
      data: {
        name: input.name.trim(),
        email,
        documentId,
        phone: input.phone?.trim() || null,
        passwordHash: await hashPassword(input.password),
      },
    });
    return { customer };
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "DOCUMENT_TAKEN" }; // alguien lo creó justo ahora
    throw error;
  }
}

/** Completa o corrige los datos de una cuenta (las antiguas no tenían carnet). */
export async function updateCustomerProfile(
  customerId: string,
  input: { name: string; document: string; phone?: string },
): Promise<{ ok: true } | { error: "DOCUMENT_TAKEN" | "DOCUMENT_INVALID" }> {
  const documentId = normalizeDocument(input.document);
  if (!isValidDocument(documentId)) return { error: "DOCUMENT_INVALID" };
  const other = await prisma.customer.findUnique({ where: { documentId }, select: { id: true } });
  if (other && other.id !== customerId) return { error: "DOCUMENT_TAKEN" };
  try {
    await prisma.customer.update({
      where: { id: customerId },
      data: { name: input.name.trim(), documentId, phone: input.phone?.trim() || null },
    });
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "DOCUMENT_TAKEN" };
    throw error;
  }
}

/**
 * Devuelve el staff con su organización y rol, solo si la cuenta está activa y su
 * organización no está suspendida.
 */
export async function verifyStaffCredentials(email: string, password: string) {
  const staff = await prisma.staffUser.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: {
      memberships: { orderBy: { createdAt: "asc" }, take: 1, include: { organization: { select: { status: true } } } },
    },
  });
  if (!(await passwordMatches(password, staff?.passwordHash))) return null;
  const membership = staff?.memberships[0];
  if (!staff || !staff.active || !membership || membership.organization.status !== "ACTIVE") return null;
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    role: membership.role,
    organizationId: membership.organizationId,
    clientId: membership.clientId,
  };
}

export async function createStaffUser(input: {
  organizationId: string;
  name: string;
  email: string;
  password: string;
  role: StaffRole;
  /** Obligatorio para el rol CLIENT: el cliente cuyos eventos podrá ver. */
  clientId?: string;
  /** Contraseña temporal: la tiene que cambiar al entrar. */
  mustChangePassword?: boolean;
}) {
  try {
    return await prisma.staffUser.create({
      data: {
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        passwordHash: await hashPassword(input.password),
        mustChangePassword: input.mustChangePassword ?? false,
        memberships: {
          create: { organizationId: input.organizationId, role: input.role, clientId: input.clientId ?? null },
        },
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/**
 * Cambia la contraseña de una cuenta del panel verificando la actual. Devuelve false si
 * la actual no coincide. Al cambiarla deja de ser temporal.
 */
export async function changeStaffPassword(userId: string, current: string, next: string) {
  const staff = await prisma.staffUser.findUnique({ where: { id: userId } });
  if (!staff || !(await passwordMatches(current, staff.passwordHash))) return false;
  await prisma.staffUser.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(next), mustChangePassword: false },
  });
  return true;
}
