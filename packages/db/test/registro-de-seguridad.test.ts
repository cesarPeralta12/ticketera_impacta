/**
 * Registro de seguridad: cada evento guarda quién, qué, cuándo y desde dónde (IP, navegador, teléfono);
 * avisa de dispositivos nuevos, se filtra por organización y los eventos de acceso caducan a los 12 meses.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { createStaffUser } from "../src/operations/accounts";
import {
  listAuditEvents,
  purgeOldSecurityEvents,
  recordAudit,
  recordLogin,
  recordLoginFailure,
  securitySummary,
} from "../src/operations/security";

afterAll(() => prisma.$disconnect());

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0";

async function organization() {
  const suffix = randomCode(6).toLowerCase();
  const org = await prisma.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}`, currency: "BOB" } });
  const user = (await createStaffUser({ organizationId: org.id, name: `Ana ${suffix}`, email: `ana-${suffix}@prueba.test`, password: "Prueba2026!", role: "ADMIN" }))!;
  return { org, user, suffix };
}

describe("recordAudit", () => {
  it("guarda desde dónde se hizo y deduce la organización de la cuenta del actor", async () => {
    const { org, user } = await organization();
    await recordAudit({
      actorType: "staff",
      actorId: user.id,
      action: "event.publish",
      entity: "Event",
      entityId: "ev-1",
      data: { antes: "BORRADOR", despues: "PUBLICADO" },
      context: { ip: "200.87.10.5", userAgent: CHROME },
    });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { actorId: user.id, action: "event.publish" } });
    expect(row).toMatchObject({ organizationId: org.id, ip: "200.87.10.5", userAgent: CHROME, severity: "info", data: { antes: "BORRADOR", despues: "PUBLICADO" } });
  });

  it("recorta valores demasiado largos", async () => {
    const { user } = await organization();
    await recordAudit({ actorType: "staff", actorId: user.id, action: "x.y", entity: "X", entityId: "1", context: { userAgent: "a".repeat(1000), deviceName: "b".repeat(500) } });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { actorId: user.id, action: "x.y" } });
    expect(row.userAgent).toHaveLength(300);
    expect(row.deviceName).toHaveLength(80);
  });
});

describe("ingresos", () => {
  it("el primer ingreso no avisa; uno desde otro navegador sí; repetir el navegador conocido no", async () => {
    const { user } = await organization();
    const web = { ip: "200.87.10.5", userAgent: CHROME };
    expect(await recordLogin({ kind: "staff", userId: user.id, context: web })).toEqual({ newDevice: false });
    expect(await recordLogin({ kind: "staff", userId: user.id, context: web })).toEqual({ newDevice: false });
    expect(await recordLogin({ kind: "staff", userId: user.id, context: { ip: "181.1.1.1", userAgent: FIREFOX } })).toEqual({ newDevice: true });
    const warn = await prisma.auditLog.findFirstOrThrow({ where: { actorId: user.id, severity: "warn" } });
    expect(warn).toMatchObject({ action: "auth.login", ip: "181.1.1.1", data: { newDevice: true, via: "web" } });
  });

  it("en la app el teléfono se reconoce por su identificador", async () => {
    const { user } = await organization();
    const phone = (id: string) => ({ ip: "190.1.1.1", userAgent: "impacta-puerta/1.1.0 (android)", deviceId: id, deviceName: "Motorola Moto G" });
    await recordLogin({ kind: "staff", userId: user.id, context: phone("dev-1111") });
    expect(await recordLogin({ kind: "staff", userId: user.id, context: phone("dev-1111") })).toEqual({ newDevice: false });
    expect(await recordLogin({ kind: "staff", userId: user.id, context: phone("dev-2222") })).toEqual({ newDevice: true });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { actorId: user.id, severity: "warn" } })).toMatchObject({
      deviceId: "dev-2222",
      deviceName: "Motorola Moto G",
      data: { via: "app" },
    });
  });

  it("un ingreso fallido de una cuenta existente queda ligado a ella; el de un correo desconocido, anónimo", async () => {
    const { user, org } = await organization();
    await recordLoginFailure({ kind: "staff", email: user.email.toUpperCase(), reason: "CREDENTIALS", context: { ip: "9.9.9.9", userAgent: FIREFOX } });
    await recordLoginFailure({ kind: "staff", email: "nadie@prueba.test", reason: "BLOCKED", context: { ip: "9.9.9.9" } });
    const known = await prisma.auditLog.findFirstOrThrow({ where: { actorId: user.id, action: "auth.login_failed" } });
    expect(known).toMatchObject({ severity: "warn", actorType: "staff", ip: "9.9.9.9", data: { email: user.email, reason: "CREDENTIALS" } });
    const unknown = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.blocked", entityId: "nadie@prueba.test" } });
    expect(unknown).toMatchObject({ actorType: "anonymous", actorId: null });
    // No filtra la contraseña ni nada más que el correo y el motivo.
    expect(Object.keys(known.data as object).sort()).toEqual(["email", "reason", "via"]);
    expect(org.id).toBeTruthy();
  });
});

describe("consulta del registro", () => {
  it("cada organización ve solo lo suyo y se filtra por tipo, cuenta, IP y gravedad", async () => {
    const a = await organization();
    const b = await organization();
    await recordLogin({ kind: "staff", userId: a.user.id, context: { ip: "10.1.1.1", userAgent: CHROME } });
    await recordLogin({ kind: "staff", userId: a.user.id, context: { ip: "10.1.1.2", userAgent: FIREFOX } }); // nuevo → warn
    await recordAudit({ actorType: "staff", actorId: a.user.id, action: "event.publish", entity: "Event", entityId: "e1" });
    await recordLogin({ kind: "staff", userId: b.user.id, context: { ip: "10.2.2.2", userAgent: CHROME } });

    const mine = await listAuditEvents({ organizationId: a.org.id });
    expect(mine.total).toBe(3);
    expect(mine.rows.every((r) => r.actor.email === a.user.email)).toBe(true);

    expect((await listAuditEvents({ organizationId: a.org.id, scope: "security" })).total).toBe(2);
    expect((await listAuditEvents({ organizationId: a.org.id, scope: "changes" })).rows.map((r) => r.action)).toEqual(["event.publish"]);
    expect((await listAuditEvents({ organizationId: a.org.id, onlyWarnings: true })).total).toBe(1);
    expect((await listAuditEvents({ organizationId: a.org.id, ip: "10.1.1.2" })).total).toBe(1);
    expect((await listAuditEvents({ organizationId: a.org.id, action: "auth." })).total).toBe(2);
    expect((await listAuditEvents({ organizationId: a.org.id, actor: a.suffix })).total).toBe(3);
    expect((await listAuditEvents({ organizationId: a.org.id, actor: b.suffix })).total).toBe(0);
    expect((await listAuditEvents({ organizationId: b.org.id })).total).toBe(1);
  });

  it("pagina y filtra por fechas", async () => {
    const { org, user } = await organization();
    for (let i = 0; i < 5; i++) {
      await recordAudit({ actorType: "staff", actorId: user.id, action: "venue.update", entity: "Venue", entityId: `v${i}` }, new Date(Date.UTC(2026, 0, 10 + i)));
    }
    const page1 = await listAuditEvents({ organizationId: org.id, pageSize: 2, page: 1 });
    const page3 = await listAuditEvents({ organizationId: org.id, pageSize: 2, page: 3 });
    expect([page1.total, page1.rows.length, page3.rows.length]).toEqual([5, 2, 1]);
    expect(page1.rows[0]!.entityId).toBe("v4"); // lo más reciente primero
    const range = await listAuditEvents({ organizationId: org.id, from: new Date(Date.UTC(2026, 0, 11)), to: new Date(Date.UTC(2026, 0, 13)) });
    expect(range.rows.map((r) => r.entityId).sort()).toEqual(["v1", "v2"]);
  });

  it("encuentra un ingreso fallido por el correo con el que se intentó, aunque la cuenta no exista", async () => {
    const mail = `intruso-${randomCode(6).toLowerCase()}@prueba.test`;
    await recordLoginFailure({ kind: "customer", email: mail, reason: "CREDENTIALS", context: { ip: "7.7.7.7" } });
    const found = await listAuditEvents({ actor: mail.split("@")[0] });
    expect(found.rows[0]).toMatchObject({ action: "auth.login_failed", actor: { email: mail } });
  });

  it("el resumen cuenta fallos, bloqueos, dispositivos nuevos y las IP más activas", async () => {
    const { org, user } = await organization();
    const since = new Date(Date.now() - 60_000);
    await recordLoginFailure({ kind: "staff", email: user.email, reason: "CREDENTIALS", context: { ip: "5.5.5.5" } });
    await recordLoginFailure({ kind: "staff", email: user.email, reason: "CREDENTIALS", context: { ip: "5.5.5.5" } });
    await recordLoginFailure({ kind: "staff", email: user.email, reason: "BLOCKED", context: { ip: "6.6.6.6" } });
    await recordAudit({ actorType: "staff", actorId: user.id, action: "auth.sessions_revoked", entity: "StaffUser", entityId: user.id });
    const s = await securitySummary({ organizationId: org.id, since });
    expect(s).toMatchObject({ failedLogins: 2, blocked: 1, newDevices: 0, sessionsRevoked: 1, tokenReuse: 0 });
    expect(s.topIps[0]).toEqual({ ip: "5.5.5.5", count: 2 });
  });
});

describe("retención", () => {
  it("borra los eventos de acceso de más de 12 meses y conserva los de negocio", async () => {
    const { user } = await organization();
    const old = new Date(Date.now() - 400 * 24 * 3_600_000);
    await recordAudit({ actorType: "staff", actorId: user.id, action: "auth.login", entity: "StaffUser", entityId: user.id }, old);
    await recordAudit({ actorType: "staff", actorId: user.id, action: "order.refund", entity: "Order", entityId: "o1" }, old);
    await recordAudit({ actorType: "staff", actorId: user.id, action: "auth.login", entity: "StaffUser", entityId: user.id });
    await purgeOldSecurityEvents();
    const left = await prisma.auditLog.findMany({ where: { actorId: user.id }, select: { action: true, createdAt: true } });
    expect(left.map((r) => r.action).sort()).toEqual(["auth.login", "order.refund"]);
    expect(left.find((r) => r.action === "auth.login")!.createdAt.getTime()).toBeGreaterThan(old.getTime());
  });
});
