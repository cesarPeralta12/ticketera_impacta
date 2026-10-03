import QRCode from "qrcode";
import { signTicketPayload } from "@ticketera/core";
import { requireEnv } from "@ticketera/db";

/** SVG del QR firmado de una entrada (el mismo que muestra la web al comprador). */
export async function ticketQrSvg(code: string) {
  return QRCode.toString(await signTicketPayload(code, requireEnv("TICKET_QR_SECRET")), {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

/** Enlace público de la orden en la web: ahí el comprador o invitado ve su QR. */
export function orderUrl(code: string) {
  return `${requireEnv("WEB_URL").replace(/\/$/, "")}/orden/${code}`;
}
