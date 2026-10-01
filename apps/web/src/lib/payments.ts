/**
 * Pasarelas de pago. Hoy solo existe la simulada ("mock"); la real se agrega aquí cuando
 * se decida en el Sprint 0, implementando lo mismo: URL de checkout + webhook verificado.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@ticketera/db";

export const MOCK_PROVIDER = "mock";

export function activeProvider(): string {
  return requireEnv("PAYMENT_PROVIDER");
}

export function isMockEnabled(): boolean {
  return process.env.PAYMENT_PROVIDER === MOCK_PROVIDER;
}

/** Adónde se envía al comprador para pagar. */
export function checkoutUrl(payment: { id: string; provider: string }): string {
  if (payment.provider === MOCK_PROVIDER) return `/pago-simulado/${payment.id}`;
  throw new Error(`Pasarela "${payment.provider}" no implementada.`);
}

// ─── Pasarela simulada ───────────────────────────────────────────────────────

/**
 * Notificación que envía la pasarela simulada. A diferencia de una pasarela real, trae el
 * estado en el cuerpo (firmado). Con una pasarela real, el webhook solo trae un id y el
 * estado se consulta a su API: nunca se confía en el contenido sin verificarlo.
 */
export type MockNotification = {
  id: string;
  type: "payment";
  data: {
    paymentId: string;
    providerPaymentId: string;
    status: "approved" | "rejected";
    amount: number;
    currency: string;
  };
};

function signMock(body: string): string {
  return createHmac("sha256", requireEnv("PAYMENT_MOCK_SECRET")).update(body).digest("hex");
}

export function verifyMockSignature(body: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signMock(body), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Lo que hace una pasarela real al terminar un pago: avisar al servidor del comercio. */
export async function sendMockWebhook(payment: {
  id: string;
  amount: number;
  currency: string;
  status: "approved" | "rejected";
}) {
  const notification: MockNotification = {
    id: randomUUID(),
    type: "payment",
    data: {
      paymentId: payment.id,
      providerPaymentId: `mock_${randomUUID().slice(0, 8)}`,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
    },
  };
  const body = JSON.stringify(notification);
  const response = await fetch(`${requireEnv("WEB_URL")}/api/webhooks/mock`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mock-signature": signMock(body) },
    body,
  });
  if (!response.ok) throw new Error(`El webhook respondió ${response.status}`);
}
