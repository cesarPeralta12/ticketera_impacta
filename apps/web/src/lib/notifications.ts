import { sendTicketsEmail } from "./mail";

/**
 * Cuando un pago queda aprobado, las entradas llegan al correo de la cuenta (QR dentro del mensaje y
 * enlace a "Mis entradas"). Si el envío falla no se rompe el pago: la persona las ve igual en el sitio.
 */
export async function notifyOrderPaid(orderCode: string) {
  await sendTicketsEmail(orderCode);
}
