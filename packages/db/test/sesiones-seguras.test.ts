/**
 * Sesiones revocables: token de acceso corto con renovación que rota (y detecta reutilización), versión de
 * sesión que se invalida al cambiar la contraseña o al cerrar todas las sesiones.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import {
  changeStaffPassword,
  createStaffUser,
  hashPassword,
  revokeAllSessions,
  verifyCustomerCredentials,
  verifyStaffCredentials,
} from "../src/operations/accounts";
import { changeCustomerPassword } from "../src/operations/email-tokens";
import { authenticateDevice, refreshDeviceSession, startDeviceSession } from "../src/operations/mobile";

afterAll(() => prisma.$disconnect());

const PASSWORD = "Prueba2026!";
const NEW_PASSWORD = "Nueva2026!!";

async function portero() {
  const suffix = randomCode(6).toLowerCase();
  const org = await prisma.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}`, currency: "BOB" } });
  const user = (await createStaffUser({ organizationId: org.id, name: "Portero", email: `p-${suffix}@prueba.test`, password: PASSWORD, role: "OPERATOR" }))!;
  return { org, user };
}

async function login(email: string, deviceId = `dev-${randomCode(6)}`) {
  const r = await startDeviceSession({
    email,
    password: PASSWORD,
    deviceId,
    deviceName: "Moto G",
    context: { ip: "200.87.1.1", appVersion: "1.2.0", platform: "android" },
  });
  if ("error" in r) throw new Error(r.error);
  return r;
}

describe("token de acceso y renovación", () => {
  it("el login entrega un token de acceso corto y uno de renovación, y guarda solo los hashes", async () => {
    const { user } = await portero();
    const r = await login(user.email);
    expect(r.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    expect(r.refreshToken).not.toBe(r.token);
    const row = await prisma.deviceToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.refreshHash).not.toBe(r.refreshToken);
    expect(row).toMatchObject({ ip: "200.87.1.1", appVersion: "1.2.0", platform: "android" });
  });

  it("renovar entrega un par nuevo y el anterior deja de valer", async () => {
    const { user } = await portero();
    const first = await login(user.email);
    const renewed = await refreshDeviceSession(first.refreshToken, { ip: "200.87.1.9" });
    if (!renewed.ok) throw new Error(renewed.reason);
    expect(await authenticateDevice(first.token)).toBeNull();
    expect(await authenticateDevice(renewed.token)).toMatchObject({ id: user.id });
    expect(renewed.refreshToken).not.toBe(first.refreshToken);
    expect((await prisma.deviceToken.findUniqueOrThrow({ where: { id: renewed.deviceTokenId } })).ip).toBe("200.87.1.9");
  });

  it("un token de acceso vencido no sirve, pero se renueva con el de renovación", async () => {
    const { user } = await portero();
    const r = await login(user.email);
    await prisma.deviceToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await authenticateDevice(r.token)).toBeNull();
    const renewed = await refreshDeviceSession(r.refreshToken);
    expect(renewed.ok).toBe(true);
  });

  it("reutilizar un token de renovación ya cambiado (robo) cierra la sesión del teléfono", async () => {
    const { user } = await portero();
    const first = await login(user.email);
    const renewed = await refreshDeviceSession(first.refreshToken);
    if (!renewed.ok) throw new Error(renewed.reason);
    // Pasado el margen de reintento, presentar el viejo es sospechoso.
    await prisma.deviceToken.updateMany({ where: { userId: user.id }, data: { rotatedAt: new Date(Date.now() - 5 * 60_000) } });
    const stolen = await refreshDeviceSession(first.refreshToken);
    expect(stolen).toMatchObject({ ok: false, reason: "REUSED", userId: user.id });
    // Ni el ladrón ni el teléfono verdadero siguen dentro.
    expect(await authenticateDevice(renewed.token)).toBeNull();
    expect(await refreshDeviceSession(renewed.refreshToken)).toMatchObject({ ok: false, reason: "INVALID" });
  });

  it("un reintento inmediato (se perdió la respuesta) no se toma por robo", async () => {
    const { user } = await portero();
    const first = await login(user.email);
    const a = await refreshDeviceSession(first.refreshToken);
    const b = await refreshDeviceSession(first.refreshToken); // misma petición repetida
    expect(a.ok && b.ok).toBe(true);
    if (b.ok) expect(await authenticateDevice(b.token)).toMatchObject({ id: user.id });
  });

  it("no renueva con la sesión vencida, revocada, la cuenta desactivada o un token inventado", async () => {
    const { user } = await portero();
    const r = await login(user.email);
    expect(await refreshDeviceSession("token-inventado")).toMatchObject({ ok: false, reason: "INVALID" });

    await prisma.deviceToken.updateMany({ where: { userId: user.id }, data: { refreshExpiresAt: new Date(Date.now() - 1000) } });
    expect(await refreshDeviceSession(r.refreshToken)).toMatchObject({ ok: false, reason: "INVALID" });
    await prisma.deviceToken.updateMany({ where: { userId: user.id }, data: { refreshExpiresAt: new Date(Date.now() + 86_400_000) } });

    await prisma.staffUser.update({ where: { id: user.id }, data: { active: false } });
    expect(await refreshDeviceSession(r.refreshToken)).toMatchObject({ ok: false, reason: "INVALID" });
    await prisma.staffUser.update({ where: { id: user.id }, data: { active: true } });

    await prisma.deviceToken.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });
    expect(await refreshDeviceSession(r.refreshToken)).toMatchObject({ ok: false, reason: "INVALID" });
  });

  it("un organizador suspendido no puede renovar", async () => {
    const { user, org } = await portero();
    const r = await login(user.email);
    await prisma.organization.update({ where: { id: org.id }, data: { status: "SUSPENDED" } });
    expect(await refreshDeviceSession(r.refreshToken)).toMatchObject({ ok: false, reason: "INVALID" });
  });
});

describe("versión de sesión", () => {
  it("cambiar la contraseña sube la versión y cierra los teléfonos, salvo el que lo hace", async () => {
    const { user } = await portero();
    const phoneA = await login(user.email, "dev-aaaa");
    const phoneB = await login(user.email, "dev-bbbb");
    const before = (await verifyStaffCredentials(user.email, PASSWORD))!.sessionVersion;
    const keep = (await authenticateDevice(phoneA.token))!.deviceTokenId;

    expect(await changeStaffPassword(user.id, PASSWORD, NEW_PASSWORD, { keepDeviceTokenId: keep })).toBe(true);
    expect((await verifyStaffCredentials(user.email, NEW_PASSWORD))!.sessionVersion).toBe(before + 1);
    expect(await authenticateDevice(phoneA.token)).not.toBeNull();
    expect(await authenticateDevice(phoneB.token)).toBeNull();
  });

  it("cerrar todas las sesiones sube la versión y revoca todos los teléfonos", async () => {
    const { user } = await portero();
    const phone = await login(user.email);
    const r = await revokeAllSessions("staff", user.id);
    expect(r.devices).toBe(1);
    expect(await authenticateDevice(phone.token)).toBeNull();
    expect((await prisma.staffUser.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(1);
  });

  it("en un comprador, cambiar la contraseña o cerrar las sesiones sube su versión", async () => {
    const customer = await prisma.customer.create({
      data: {
        email: `c-${randomCode(6).toLowerCase()}@prueba.test`,
        name: "Comprador",
        passwordHash: await hashPassword(PASSWORD),
        emailVerified: true,
      },
    });
    expect((await verifyCustomerCredentials(customer.email, PASSWORD))!.sessionVersion).toBe(0);
    expect(await changeCustomerPassword(customer.id, PASSWORD, NEW_PASSWORD)).toMatchObject({ ok: true });
    expect((await verifyCustomerCredentials(customer.email, NEW_PASSWORD))!.sessionVersion).toBe(1);
    await revokeAllSessions("customer", customer.id);
    expect((await verifyCustomerCredentials(customer.email, NEW_PASSWORD))!.sessionVersion).toBe(2);
  });
});
