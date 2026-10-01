import {
  DomainError,
  applyPaymentUpdate,
  markWebhookProcessed,
  recordWebhookEvent,
} from "@ticketera/db";
import { notifyOrderPaid } from "@/lib/notifications";
import { MOCK_PROVIDER, isMockEnabled, verifyMockSignature, type MockNotification } from "@/lib/payments";

/**
 * Webhook de la pasarela simulada. Es el ÚNICO lugar donde un pago se da por aprobado:
 * el retorno del navegador desde la pasarela no confirma nada.
 */
export async function POST(request: Request) {
  if (!isMockEnabled()) return new Response("Not found", { status: 404 });

  const body = await request.text();
  if (!verifyMockSignature(body, request.headers.get("x-mock-signature"))) {
    return Response.json({ ok: false, error: "firma inválida" }, { status: 401 });
  }

  const notification = JSON.parse(body) as MockNotification;
  const { event, alreadyProcessed } = await recordWebhookEvent({
    provider: MOCK_PROVIDER,
    externalId: notification.id,
    topic: notification.type,
    payload: notification,
  });
  if (alreadyProcessed) return Response.json({ ok: true, duplicate: true });

  try {
    const { data } = notification;
    const { outcome, orderCode } = await applyPaymentUpdate({
      paymentId: data.paymentId,
      provider: MOCK_PROVIDER,
      providerPaymentId: data.providerPaymentId,
      status: data.status === "approved" ? "APPROVED" : "REJECTED",
      providerStatus: data.status,
      amount: data.amount,
      currency: data.currency,
    });
    await markWebhookProcessed(event.id);
    if (outcome === "PAID") await notifyOrderPaid(orderCode);
    return Response.json({ ok: true, outcome });
  } catch (error) {
    await markWebhookProcessed(event.id, error instanceof Error ? error.message : String(error));
    if (error instanceof DomainError) {
      // Dato inconsistente: reintentar no lo arregla. Queda registrado en WebhookEvent.error.
      console.error(`[webhook mock] ${error.code}: ${error.message}`);
      return Response.json({ ok: false, error: error.message });
    }
    throw error; // 500: la pasarela reintenta más tarde.
  }
}
