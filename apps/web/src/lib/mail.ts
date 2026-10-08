import QRCode from "qrcode";
import { signTicketPayload } from "@ticketera/core";
import {
  RESET_PASSWORD_MINUTES,
  VERIFY_EMAIL_HOURS,
  getOrderByCode,
  requestCustomerEmailVerification,
  requestCustomerPasswordReset,
  requireEnv,
} from "@ticketera/db";
import {
  passwordChangedMessage,
  resetPasswordMessage,
  sendEmailSafely,
  ticketsMessage,
  verifyEmailMessage,
} from "@ticketera/mail";

const baseUrl = () => requireEnv("WEB_URL").replace(/\/$/, "");

/** Envía (o reenvía) el correo para confirmar el email. Devuelve false si todavía hay que esperar o ya está confirmado. */
export async function sendVerificationEmail(customerId: string): Promise<"sent" | "wait" | "verified" | "failed"> {
  const issued = await requestCustomerEmailVerification(customerId);
  if (issued.status === "ALREADY_VERIFIED") return "verified";
  if (issued.status !== "SENT") return "wait";
  const ok = await sendEmailSafely(
    verifyEmailMessage({
      to: issued.email,
      name: issued.name,
      link: `${baseUrl()}/cuenta/verificar?token=${issued.token}`,
      hours: VERIFY_EMAIL_HOURS,
    }),
  );
  return ok ? "sent" : "failed";
}

/** "Olvidé mi contraseña": envía el enlace si la cuenta existe. Quien lo pide nunca sabe si existía. */
export async function sendPasswordResetEmail(email: string) {
  const issued = await requestCustomerPasswordReset(email);
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

export async function sendPasswordChangedEmail(to: string, name: string) {
  await sendEmailSafely(passwordChangedMessage({ to, name }));
}

/**
 * Envía las entradas de una orden pagada al correo de la cuenta: el QR de cada entrada va como imagen
 * dentro del mensaje y un botón abre la versión actualizada en el sitio.
 */
export async function sendTicketsEmail(orderCode: string): Promise<boolean> {
  const order = await getOrderByCode(orderCode);
  if (!order || order.status !== "PAID" || order.tickets.length === 0) return false;
  const session = order.items[0]?.ticketType.session;
  if (!session) return false;
  const secret = requireEnv("TICKET_QR_SECRET");

  const tickets = await Promise.all(
    order.tickets
      .filter((t) => t.status !== "CANCELLED")
      .map(async (t) => ({
        code: t.code,
        typeName: t.ticketType.name,
        seat: t.seat ? `${t.seat.section.name} · ${t.seat.label}` : null,
        // Solo si el tipo de entrada se lee por QR: una entrada solo NFC o solo código de barras no lleva QR.
        qrPng: t.ticketType.accessMethods.includes("QR")
          ? await QRCode.toBuffer(await signTicketPayload(t.code, secret), { type: "png", margin: 1, width: 400, errorCorrectionLevel: "M" })
          : null,
      })),
  );
  return sendEmailSafely(
    ticketsMessage({
      to: order.buyerEmail,
      buyerName: order.buyerName,
      eventTitle: session.event.title,
      startsAt: session.startsAt,
      timezone: session.venue.timezone,
      venueName: session.venue.name,
      orderCode: order.code,
      orderUrl: `${baseUrl()}/orden/${order.code}`,
      tickets,
    }),
  );
}
