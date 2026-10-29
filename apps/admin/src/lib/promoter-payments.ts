import { SIMULATED_PROVIDER } from "@ticketera/db";
import { orderUrl } from "@/lib/qr";

/**
 * Cobro por QR de las ventas de los promotores. Con un banco o pasarela conectada (PAYMENT_PROVIDER), es su QR y su
 * webhook el que aprueba el pago; mientras no haya, el cobro es de prueba (simulado) y no cobra nada.
 */
export function promoterPaymentProvider(): string {
  const provider = process.env.PAYMENT_PROVIDER?.trim();
  return provider && provider !== "directo" ? provider : SIMULATED_PROVIDER;
}

/**
 * ¿Se puede aprobar a mano el cobro de prueba? En la computadora de desarrollo, sí; en un servidor, solo si se
 * activó a propósito con PAGO_SIMULADO=si (para probar antes de conectar el banco: quitarlo antes de vender en serio).
 */
export function simulatedPaymentsAllowed(): boolean {
  return promoterPaymentProvider() === SIMULATED_PROVIDER && (process.env.NODE_ENV !== "production" || process.env.PAGO_SIMULADO === "si");
}

/** El mensaje de WhatsApp para el cliente, con el enlace de sus entradas (ahí ve los QR). */
export function ticketsMessage(name: string, event: string, code: string) {
  return `Hola ${name.split(" ")[0]}, aquí están tus entradas para ${event}: ${orderUrl(code)}\nMuestra el QR en la puerta.`;
}
