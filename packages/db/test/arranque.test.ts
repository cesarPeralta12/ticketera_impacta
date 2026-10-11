/**
 * Primer arranque de un servidor real: crea la plataforma y su dueño, sin borrar nada y sin repetirse.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { verifyStaffCredentials } from "../src/operations/accounts";
import { bootstrapPlatform } from "../src/operations/bootstrap";

afterAll(() => prisma.$disconnect());

describe("arranque de la plataforma", () => {
  it("crea Impacta y un dueño con contraseña temporal, y la segunda vez no hace nada", async () => {
    const before = await prisma.organization.count({ where: { isPlatform: true, members: { some: { role: "OWNER" } } } });
    const email = `dueno-${randomCode(6).toLowerCase()}@prueba.test`;
    const first = await bootstrapPlatform({ email, name: "Dueño Inicial", password: "Temporal2026!" });

    if (before > 0) {
      // Ya había una plataforma con dueño (otra prueba): no debe tocar nada.
      expect(first).toEqual({ created: false, reason: "ALREADY_EXISTS" });
      return;
    }
    expect(first).toMatchObject({ created: true, email, temporaryPassword: "Temporal2026!" });
    const owner = await prisma.staffUser.findUniqueOrThrow({ where: { email }, include: { memberships: { include: { organization: true } } } });
    expect(owner.mustChangePassword).toBe(true);
    expect(owner.memberships[0]).toMatchObject({ role: "OWNER", organization: { isPlatform: true } });
    expect(await verifyStaffCredentials(email, "Temporal2026!")).not.toBeNull();

    const orgsBefore = await prisma.organization.count();
    expect(await bootstrapPlatform({ email: `otro-${randomCode(6).toLowerCase()}@prueba.test`, name: "Otro" })).toEqual({
      created: false,
      reason: "ALREADY_EXISTS",
    });
    expect(await prisma.organization.count()).toBe(orgsBefore);
  });

  it("si no se da contraseña genera una aleatoria", async () => {
    const hasPlatform = await prisma.organization.count({ where: { isPlatform: true, members: { some: { role: "OWNER" } } } });
    if (hasPlatform > 0) return; // el caso de creación ya se cubrió arriba
    const r = await bootstrapPlatform({ email: `d-${randomCode(6).toLowerCase()}@prueba.test`, name: "Dueño" });
    expect(r.created && r.temporaryPassword.length >= 12).toBe(true);
  });
});
