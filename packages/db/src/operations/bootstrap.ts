/**
 * Primer arranque de un servidor real: crea la organización de la plataforma (Impacta) y su primer dueño.
 *
 * A diferencia de la semilla de demostración, NUNCA borra nada y se puede repetir sin riesgo:
 * si ya existe una plataforma con un dueño, no hace nada.
 */
import { DEFAULT_CURRENCY } from "@ticketera/core";
import { randomBytes } from "node:crypto";
import { prisma } from "../client";
import { createStaffUser } from "./accounts";

export type BootstrapResult =
  | { created: false; reason: "ALREADY_EXISTS" }
  | { created: true; organizationId: string; email: string; temporaryPassword: string };

/**
 * Crea Impacta (isPlatform) y un OWNER con contraseña temporal (la tiene que cambiar al entrar).
 * Si no se da contraseña, genera una aleatoria y la devuelve UNA vez.
 */
export async function bootstrapPlatform(input: {
  email: string;
  name: string;
  password?: string;
  organizationName?: string;
}): Promise<BootstrapResult> {
  const existing = await prisma.organization.findFirst({
    where: { isPlatform: true, members: { some: { role: "OWNER" } } },
    select: { id: true },
  });
  if (existing) return { created: false, reason: "ALREADY_EXISTS" };

  const temporaryPassword = input.password ?? randomBytes(12).toString("base64url");
  const organization =
    (await prisma.organization.findFirst({ where: { isPlatform: true } })) ??
    (await prisma.organization.create({
      data: { name: input.organizationName ?? "Impacta", slug: "impacta", currency: DEFAULT_CURRENCY, isPlatform: true },
    }));

  const owner = await createStaffUser({
    organizationId: organization.id,
    name: input.name,
    email: input.email,
    password: temporaryPassword,
    role: "OWNER",
    mustChangePassword: true,
  });
  if (!owner) throw new Error("Ya existe una cuenta con ese email: elige otro para el primer dueño.");
  return { created: true, organizationId: organization.id, email: owner.email, temporaryPassword };
}
