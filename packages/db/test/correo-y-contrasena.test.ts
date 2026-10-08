/**
 * Enlaces por correo: confirmar el email y cambiar la contraseña, para compradores y personal.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { verifyCustomerCredentials, verifyStaffCredentials } from "../src/operations/accounts";
import {
  EMAIL_COOLDOWN_SECONDS,
  MAX_EMAILS_PER_HOUR,
  changeCustomerPassword,
  confirmCustomerEmail,
  isEmailTokenValid,
  requestCustomerEmailVerification,
  requestCustomerPasswordReset,
  requestStaffPasswordReset,
  resetCustomerPassword,
  resetStaffPassword,
} from "../src/operations/email-tokens";
import { createStaffUser, registerCustomer } from "../src/operations/accounts";
import { createGeneralAdmissionEvent } from "./fixtures";
import { startDeviceSession } from "../src/operations/mobile";

afterAll(() => prisma.$disconnect());

const unique = () => randomCode(6).toLowerCase();
const OLD = "ContraseñaVieja2026";
const NEW = "ContraseñaNueva2026";
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

async function newCustomer() {
  const result = await registerCustomer({
    name: "Ana Rojas",
    email: `a-${unique()}@prueba.test`,
    password: OLD,
    document: String(1_000_000 + Math.floor(Math.random() * 8_999_999)),
  });
  if (!("customer" in result)) throw new Error(result.error);
  return result.customer;
}

describe("confirmar el correo", () => {
  it("una cuenta nueva no está confirmada; el enlace la confirma una sola vez", async () => {
    const customer = await newCustomer();
    expect(customer.emailVerified).toBe(false);

    const issued = await requestCustomerEmailVerification(customer.id);
    if (issued.status !== "SENT") throw new Error(issued.status);
    expect(await isEmailTokenValid(issued.token, "VERIFY_EMAIL")).toBe(true);
    expect(await confirmCustomerEmail(issued.token)).toEqual({ ok: true, email: customer.email });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).emailVerified).toBe(true);
    // El mismo enlace no sirve dos veces.
    expect(await confirmCustomerEmail(issued.token)).toEqual({ ok: false });
    expect((await requestCustomerEmailVerification(customer.id, later(3600))).status).toBe("ALREADY_VERIFIED");
  });

  it("un enlace vencido o inventado no confirma nada", async () => {
    const customer = await newCustomer();
    const issued = await requestCustomerEmailVerification(customer.id);
    if (issued.status !== "SENT") throw new Error(issued.status);
    expect(await confirmCustomerEmail(issued.token, later(25 * 3600))).toEqual({ ok: false });
    expect(await confirmCustomerEmail("token-inventado")).toEqual({ ok: false });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).emailVerified).toBe(false);
  });

  it("pedir el correo otra vez anula el enlace anterior y respeta el tiempo mínimo", async () => {
    const customer = await newCustomer();
    const first = await requestCustomerEmailVerification(customer.id);
    if (first.status !== "SENT") throw new Error(first.status);
    expect((await requestCustomerEmailVerification(customer.id)).status).toBe("TOO_SOON");

    const second = await requestCustomerEmailVerification(customer.id, later(EMAIL_COOLDOWN_SECONDS + 1));
    if (second.status !== "SENT") throw new Error(second.status);
    expect(await confirmCustomerEmail(first.token)).toEqual({ ok: false });
    expect((await confirmCustomerEmail(second.token)).ok).toBe(true);
  });
});

describe("cambiar la contraseña con el enlace del correo", () => {
  it("elegir una contraseña nueva funciona una sola vez, confirma el correo y cierra la vieja", async () => {
    const customer = await newCustomer();
    const issued = await requestCustomerPasswordReset(customer.email.toUpperCase());
    if (issued.status !== "SENT") throw new Error(issued.status);

    expect(await resetCustomerPassword(issued.token, "corta")).toEqual({ ok: false, reason: "WEAK" });
    expect(await resetCustomerPassword(issued.token, NEW)).toMatchObject({ ok: true, email: customer.email });
    expect(await verifyCustomerCredentials(customer.email, OLD)).toBeNull();
    expect(await verifyCustomerCredentials(customer.email, NEW)).not.toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).emailVerified).toBe(true);
    expect(await resetCustomerPassword(issued.token, "OtraContraseña2026")).toEqual({ ok: false, reason: "INVALID_LINK" });
  });

  it("no revela si el email existe y limita los pedidos por hora", async () => {
    expect(await requestCustomerPasswordReset(`nadie-${unique()}@prueba.test`)).toEqual({ status: "IGNORED" });

    const customer = await newCustomer();
    let sent = 0;
    for (let i = 0; i < MAX_EMAILS_PER_HOUR + 2; i++) {
      // Cada pedido a más de un minuto del anterior: solo el máximo por hora llega a enviarse.
      const r = await requestCustomerPasswordReset(customer.email, later(i * (EMAIL_COOLDOWN_SECONDS + 1)));
      if (r.status === "SENT") sent++;
    }
    expect(sent).toBe(MAX_EMAILS_PER_HOUR);
  });

  it("el enlace de confirmar el correo no sirve para cambiar la contraseña", async () => {
    const customer = await newCustomer();
    const issued = await requestCustomerEmailVerification(customer.id);
    if (issued.status !== "SENT") throw new Error(issued.status);
    expect(await resetCustomerPassword(issued.token, NEW)).toEqual({ ok: false, reason: "INVALID_LINK" });
  });

  it("dentro de la cuenta pide la contraseña actual", async () => {
    const customer = await newCustomer();
    expect(await changeCustomerPassword(customer.id, "equivocada", NEW)).toEqual({ ok: false, reason: "WRONG_PASSWORD" });
    expect(await changeCustomerPassword(customer.id, OLD, "corta")).toEqual({ ok: false, reason: "WEAK" });
    expect((await changeCustomerPassword(customer.id, OLD, NEW)).ok).toBe(true);
    expect(await verifyCustomerCredentials(customer.email, NEW)).not.toBeNull();
  });
});

describe("personal del panel", () => {
  async function operator() {
    const { session } = await createGeneralAdmissionEvent({ sectionCapacity: 5, types: [{ name: "General", capacity: 5 }] });
    const event = await prisma.eventSession.findUniqueOrThrow({ where: { id: session.id }, include: { event: true } });
    const user = await createStaffUser({
      organizationId: event.event.organizationId,
      name: "Portero",
      email: `p-${unique()}@prueba.test`,
      password: OLD,
      role: "OPERATOR",
      mustChangePassword: true,
    });
    return user!;
  }

  it("cambiar la contraseña quita la marca de temporal y cierra los teléfonos con sesión", async () => {
    const user = await operator();
    const phone = await startDeviceSession({ email: user.email, password: OLD, deviceId: "dev-reset-1", deviceName: "Moto" });
    if ("error" in phone) throw new Error(phone.error);

    const issued = await requestStaffPasswordReset(user.email);
    if (issued.status !== "SENT") throw new Error(issued.status);
    expect((await resetStaffPassword(issued.token, NEW)).ok).toBe(true);

    expect((await prisma.staffUser.findUniqueOrThrow({ where: { id: user.id } })).mustChangePassword).toBe(false);
    expect(await verifyStaffCredentials(user.email, OLD)).toBeNull();
    expect(await verifyStaffCredentials(user.email, NEW)).not.toBeNull();
    const row = await prisma.deviceToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.revokedAt).not.toBeNull();
  });

  it("una cuenta desactivada no recibe el enlace", async () => {
    const user = await operator();
    await prisma.staffUser.update({ where: { id: user.id }, data: { active: false } });
    expect(await requestStaffPasswordReset(user.email)).toEqual({ status: "IGNORED" });
  });
});
