import QRCode from "qrcode";
import { TRANSFER_OFFER_HOURS, signTicketPayload } from "@ticketera/core";
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
  transferAcceptedMessage,
  transferOfferedMessage,
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

type TransferTicket = {
  code: string;
  typeName: string;
  accessMethods: ("QR" | "BARCODE" | "NFC")[];
  seat: string | null;
  eventTitle: string;
  startsAt: Date;
  venueName: string;
  timezone: string;
};

/** Avisa a la persona a quien le ofrecieron una entrada. */
export async function sendTransferOfferedEmail(offer: { ticket: TransferTicket; from: { name: string }; to: { name: string; email: string } }) {
  await sendEmailSafely(
    transferOfferedMessage({
      to: offer.to.email,
      name: offer.to.name,
      fromName: offer.from.name,
      eventTitle: offer.ticket.eventTitle,
      startsAt: offer.ticket.startsAt,
      timezone: offer.ticket.timezone,
      venueName: offer.ticket.venueName,
      typeName: offer.ticket.typeName,
      seat: offer.ticket.seat,
      link: `${baseUrl()}/mis-entradas`,
      hours: TRANSFER_OFFER_HOURS,
    }),
  );
}

/**
 * La transferencia se aceptó: quien la recibe obtiene su entrada con el QR NUEVO por correo y quien la
 * ofreció recibe la confirmación (su QR anterior ya no vale).
 */
export async function sendTransferAcceptedEmails(done: {
  ticket: TransferTicket;
  from: { name: string; email: string };
  to: { name: string; email: string };
}) {
  const secret = requireEnv("TICKET_QR_SECRET");
  const qrPng = done.ticket.accessMethods.includes("QR")
    ? await QRCode.toBuffer(await signTicketPayload(done.ticket.code, secret), { type: "png", margin: 1, width: 400, errorCorrectionLevel: "M" })
    : null;
  await sendEmailSafely(
    ticketsMessage({
      to: done.to.email,
      buyerName: done.to.name,
      eventTitle: done.ticket.eventTitle,
      startsAt: done.ticket.startsAt,
      timezone: done.ticket.timezone,
      venueName: done.ticket.venueName,
      orderUrl: `${baseUrl()}/mis-entradas`,
      tickets: [{ code: done.ticket.code, typeName: done.ticket.typeName, seat: done.ticket.seat, qrPng }],
    }),
  );
  await sendEmailSafely(
    transferAcceptedMessage({
      to: done.from.email,
      name: done.from.name,
      toName: done.to.name,
      eventTitle: done.ticket.eventTitle,
      typeName: done.ticket.typeName,
    }),
  );
}
