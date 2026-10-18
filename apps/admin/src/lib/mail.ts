import QRCode from "qrcode";
import { entranceText, gateInfo, signTicketPayload, whenWhere } from "@ticketera/core";
import { RESET_PASSWORD_MINUTES, getOrderByCode, requestStaffPasswordReset, requireEnv } from "@ticketera/db";
import { passwordChangedMessage, resetPasswordMessage, sendEmailSafely, ticketsMessage } from "@ticketera/mail";

const baseUrl = () => (process.env.ADMIN_URL ?? "http://localhost:3001").replace(/\/$/, "");

/** "Olvidé mi contraseña" del personal del panel. Quien lo pide nunca sabe si la cuenta existía. */
export async function sendStaffResetEmail(email: string) {
  const issued = await requestStaffPasswordReset(email);
  if (issued.status !== "SENT") return;
  await sendEmailSafely(
    resetPasswordMessage({
      to: issued.email,
      name: issued.name,
      link: `${baseUrl()}/restablecer?token=${issued.token}`,
      minutes: RESET_PASSWORD_MINUTES,
    }),
  );
}

export async function sendStaffPasswordChangedEmail(to: string, name: string) {
  await sendEmailSafely(passwordChangedMessage({ to, name }));
}

const webUrl = () => requireEnv("WEB_URL").replace(/\/$/, "");

/**
 * Envía las entradas de una orden pagada a su correo (el mismo mensaje que reciben las compras de la web): para las
 * importadas desde Excel, que se envían cuando el organizador lo decide.
 */
export async function sendOrderTicketsEmail(orderCode: string): Promise<boolean> {
  const order = await getOrderByCode(orderCode);
  if (!order || order.status !== "PAID" || !order.buyerEmail || order.tickets.length === 0) return false;
  const session = order.items[0]?.ticketType.session;
  if (!session) return false;
  const secret = requireEnv("TICKET_QR_SECRET");
  const gates = session.venue.accessPoints.map(gateInfo);
  const tickets = await Promise.all(
    order.tickets
      .filter((t) => t.status !== "CANCELLED")
      .map(async (t) => ({
        code: t.code,
        typeName: t.ticketType.name,
        entrance: entranceText(gates, t.ticketType.sectionId, t.ticketType.zones.map((z) => z.id)),
        seat: t.seat ? `${t.seat.section.name} · ${t.seat.label}` : null,
        dynamicUrl: t.ticketType.qrMode === "DYNAMIC" ? `${webUrl()}/entrada/${t.code}` : null,
        maxEntries: t.ticketType.maxEntries,
        qrPng:
          t.ticketType.qrMode !== "DYNAMIC" && t.ticketType.accessMethods.includes("QR")
            ? await QRCode.toBuffer(await signTicketPayload(t.code, secret), { type: "png", margin: 1, width: 400, errorCorrectionLevel: "M" })
            : null,
      })),
  );
  if (tickets.length === 0) return false;
  return sendEmailSafely(
    ticketsMessage({
      to: order.buyerEmail,
      buyerName: order.buyerName,
      eventTitle: session.event.title,
      startsAt: session.startsAt,
      timezone: session.venue.timezone,
      venueName: session.venue.name,
      orderCode: order.code,
      orderUrl: `${webUrl()}/orden/${order.code}`,
      tickets,
      whenWhere: whenWhere({ session, venue: session.venue, event: session.event }),
    }),
  );
}
