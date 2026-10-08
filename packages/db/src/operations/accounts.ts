/**
 * Cuentas de compradores (sitio público) y de staff (panel). Son tablas separadas:
 * una cuenta de comprador nunca puede entrar al panel, ni al revés.
 */
import bcrypt from "bcryptjs";
import { MIN_PASSWORD_LENGTH } from "@ticketera/core";
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

export async function registerCustomer(input: { name: string; email: string; password: string }) {
  try {
    return await prisma.customer.create({
      data: {
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        passwordHash: await hashPassword(input.password),
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return null; // ya existe una cuenta con ese email
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
