/**
 * Comprar exige cuenta con carnet: los datos del comprador salen de la cuenta y el carnet es único.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { registerCustomer, updateCustomerProfile } from "../src/operations/accounts";
import { createPendingOrder } from "../src/operations/orders";
import { sellAtBoxOffice } from "../src/operations/sales";
import { createGeneralAdmissionEvent } from "./fixtures";

afterAll(() => prisma.$disconnect());

const PASSWORD = "Prueba2026!";
const unique = () => randomCode(6).toLowerCase();
/** Carnet de 7 dígitos distinto en cada prueba. */
const newDocument = () => String(1_000_000 + Math.floor(Math.random() * 8_999_999));

async function event() {
  const { session, types } = await createGeneralAdmissionEvent({ sectionCapacity: 10, types: [{ name: "General", capacity: 10 }] });
  return { session, type: types[0]! };
}

async function account(document: string | null) {
  return prisma.customer.create({
    data: { email: `c-${unique()}@prueba.test`, name: "Ana Rojas", passwordHash: "!", documentId: document },
  });
}

describe("comprar online exige cuenta con carnet", () => {
  it("sin sesión no se puede comprar", async () => {
    const { session, type } = await event();
    await expect(
      createPendingOrder({
        sessionId: session.id,
        items: [{ ticketTypeId: type.id, quantity: 1 }],
        buyer: { name: "Ana", email: "ana@prueba.test", document: "1234567" },
      }),
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it("una cuenta sin carnet debe completarlo antes de comprar", async () => {
    const { session, type } = await event();
    const old = await account(null);
    const attempt = () =>
      createPendingOrder(
        {
          sessionId: session.id,
          items: [{ ticketTypeId: type.id, quantity: 1 }],
          buyer: { name: "Ana", email: "ana@prueba.test", document: "1234567" },
        },
        { customerId: old.id },
      );
    await expect(attempt()).rejects.toMatchObject({ code: "DOCUMENT_REQUIRED" });

    expect(await updateCustomerProfile(old.id, { name: "Ana Rojas", document: newDocument() })).toEqual({ ok: true });
    await expect(attempt()).resolves.toBeTruthy();
  });

  it("los datos del comprador salen de la cuenta, no del formulario", async () => {
    const { session, type } = await event();
    const document = newDocument();
    const customer = await account(document);
    const order = await createPendingOrder(
      {
        sessionId: session.id,
        items: [{ ticketTypeId: type.id, quantity: 2 }],
        // Alguien intenta comprar a nombre de otra persona.
        buyer: { name: "Otra Persona", email: "otra@prueba.test", document: "9999999" },
      },
      { customerId: customer.id },
    );
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved).toMatchObject({ customerId: customer.id, buyerName: "Ana Rojas", buyerEmail: customer.email, buyerDocument: document });
  });

  it("en boletería el carnet del cliente también es obligatorio", async () => {
    const { session, type } = await event();
    const cashier = await prisma.staffUser.create({ data: { email: `caja-${unique()}@prueba.test`, name: "Caja", passwordHash: "!" } });
    const sale = (document: string) =>
      sellAtBoxOffice(
        { sessionId: session.id, items: [{ ticketTypeId: type.id, quantity: 1 }], buyer: { name: "", email: "", document } },
        { staffId: cashier.id, method: "EFECTIVO" },
      );
    await expect(sale("")).rejects.toThrow();
    await expect(sale("12")).rejects.toThrow();
    const order = await sale("1.234.567-lp");
    expect(order.buyerDocument).toBe("1234567LP");
  });
});

describe("registro y carnet único", () => {
  it("el registro exige un carnet válido y lo guarda normalizado", async () => {
    const email = `r-${unique()}@prueba.test`;
    expect(await registerCustomer({ name: "Luis Vargas", email, password: PASSWORD, document: "12" })).toEqual({ error: "DOCUMENT_INVALID" });
    const result = await registerCustomer({ name: "Luis Vargas", email, password: PASSWORD, document: "7.654.321-1a", phone: "70000000" });
    expect("customer" in result && result.customer.documentId).toBe("76543211A");
  });

  it("un carnet o un email solo pueden tener una cuenta (aunque cambie el formato)", async () => {
    const document = newDocument();
    const first = await registerCustomer({ name: "Marta Quispe", email: `m-${unique()}@prueba.test`, password: PASSWORD, document });
    expect("customer" in first).toBe(true);

    const sameDoc = await registerCustomer({
      name: "Otra",
      email: `o-${unique()}@prueba.test`,
      password: PASSWORD,
      document: `${document.slice(0, 3)}.${document.slice(3)}`,
    });
    expect(sameDoc).toEqual({ error: "DOCUMENT_TAKEN" });

    const email = "customer" in first ? first.customer.email : "";
    expect(await registerCustomer({ name: "Marta", email, password: PASSWORD, document: newDocument() })).toEqual({ error: "EMAIL_TAKEN" });
  });

  it("al completar el perfil tampoco se puede usar el carnet de otra cuenta", async () => {
    const taken = newDocument();
    await account(taken);
    const other = await account(null);
    expect(await updateCustomerProfile(other.id, { name: "Pedro", document: taken })).toEqual({ error: "DOCUMENT_TAKEN" });
    expect(await updateCustomerProfile(other.id, { name: "Pedro", document: "abc" })).toEqual({ error: "DOCUMENT_INVALID" });
  });
});
