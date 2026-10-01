import { getOrderByCode, requireEnv } from "@ticketera/db";

/**
 * Email de confirmación de compra. El proveedor de email aún no está definido (Sprint 0):
 * mientras tanto, el mensaje se escribe en la consola del servidor.
 */
export async function notifyOrderPaid(orderCode: string) {
  const order = await getOrderByCode(orderCode);
  if (!order) return;
  const event = order.items[0]?.ticketType.session.event.title ?? "tu evento";
  console.info(
    `[email simulado] Para: ${order.buyerEmail} · Asunto: Tus entradas para ${event} · ` +
      `${order.tickets.length} entrada(s) · ${requireEnv("WEB_URL")}/orden/${order.code}`,
  );
}
