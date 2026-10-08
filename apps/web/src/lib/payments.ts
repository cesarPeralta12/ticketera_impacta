/**
 * Pagos. Hoy el único medio es el **pase directo**: la compra queda pagada en el acto, sin cobrar
 * (sirve mientras no hay pasarela real; el cobro se hace por fuera o no se hace). Todo lo demás del
 * sistema ya está listo para una pasarela real:
 *
 *  - Un pago es un intento (Payment) con proveedor, monto y estado; las órdenes, entradas, correos
 *    y reportes no saben qué proveedor lo cobró.
 *  - `applyPaymentUpdate` (packages/db) es el único lugar que da un pago por aprobado: valida monto y
 *    moneda, resuelve reservas vencidas, pagos dobles y reembolsos, y es idempotente.
 *  - Una pasarela real agrega su proveedor aquí (qué hacer al pagar) y una ruta de webhook que
 *    verifica la firma y llama a `applyPaymentUpdate`. Ver docs/pasarela-de-pago.md.
 */
import { applyPaymentUpdate, requireEnv, startPayment } from "@ticketera/db";
import { notifyOrderPaid } from "./notifications";

export const DIRECT_PROVIDER = "directo";

/** Proveedor configurado (`PAYMENT_PROVIDER`). Sin configurar: pase directo. */
export function activeProvider(): string {
  return process.env.PAYMENT_PROVIDER?.trim() || DIRECT_PROVIDER;
}

export function isDirectPass(provider: string = activeProvider()): boolean {
  return provider === DIRECT_PROVIDER;
}

let warned = false;
/** El pase directo no cobra: avisar en el servidor si se está usando en producción. */
export function warnIfDirectInProduction() {
  if (!warned && process.env.NODE_ENV === "production" && isDirectPass()) {
    warned = true;
    console.warn("[pagos] PAYMENT_PROVIDER=directo en producción: las compras se aprueban SIN cobrar. Configura una pasarela.");
  }
}

/**
 * Pase directo: abre el pago y lo aprueba en el momento (misma transacción y mismas reglas que un
 * webhook de pasarela), y envía las entradas por correo. Devuelve el resultado del pago.
 */
export async function payDirect(orderCode: string) {
  warnIfDirectInProduction();
  const payment = await startPayment(orderCode, DIRECT_PROVIDER);
  const { outcome } = await applyPaymentUpdate({
    paymentId: payment.id,
    provider: DIRECT_PROVIDER,
    providerPaymentId: `directo_${payment.id}`,
    status: "APPROVED",
    providerStatus: "pase_directo",
    amount: payment.amount,
    currency: payment.currency,
  });
  if (outcome === "PAID") await notifyOrderPaid(orderCode);
  return outcome;
}

/**
 * Adónde se envía al comprador para pagar con una pasarela real (su página de pago). Se implementa
 * al conectar la pasarela; con el pase directo no se usa porque el pago se aprueba en `payDirect`.
 */
export function checkoutUrl(payment: { id: string; provider: string }): string {
  throw new Error(`Pasarela "${payment.provider}" no implementada (ver docs/pasarela-de-pago.md). WEB_URL=${requireEnv("WEB_URL")}`);
}
