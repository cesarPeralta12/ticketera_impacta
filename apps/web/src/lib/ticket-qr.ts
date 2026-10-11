import QRCode from "qrcode";
import { signTicketPayload } from "@ticketera/core";
import { requireEnv } from "@ticketera/db";

/** SVG del QR firmado de una entrada (el que se presenta en la puerta). */
export async function ticketQrSvg(code: string) {
  return QRCode.toString(await signTicketPayload(code, requireEnv("TICKET_QR_SECRET")), {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
}
