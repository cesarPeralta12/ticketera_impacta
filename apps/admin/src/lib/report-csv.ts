import { formatCode, formatDateTime } from "@ticketera/core";
import { BOX_OFFICE_BUYER, listEventAttendees } from "@ticketera/db";
import { csvResponse } from "./csv";
import { CHANNEL_LABEL } from "./labels";

/** Asistentes de un evento como CSV descargable (una fila por entrada emitida). */
export async function attendeesCsvResponse(eventId: string, slug: string) {
  const rows = await listEventAttendees(eventId);
  const header = [
    "Función",
    "Recinto",
    "Código",
    "Nombre",
    "Email",
    "Documento",
    "Canal",
    "Tipo",
    "Sección",
    "Butaca",
    "Estado",
    "Hora de ingreso",
    "Puerta",
    "Dispositivo",
    "Leída sin conexión",
  ];
  const lines = rows.map((t) => {
    const tz = t.session.venue.timezone;
    const scan = t.scans[0];
    return [
      formatDateTime(t.session.startsAt, tz),
      t.session.venue.name,
      formatCode(t.code),
      t.holderName ?? t.order.buyerName,
      t.order.buyerEmail === BOX_OFFICE_BUYER.email ? "" : t.order.buyerEmail,
      t.order.buyerDocument,
      CHANNEL_LABEL[t.order.channel],
      t.ticketType.name,
      t.ticketType.section?.name,
      t.seat?.label,
      t.status === "USED" ? "Ingresó" : "No ingresó",
      t.usedAt ? formatDateTime(t.usedAt, tz) : "",
      scan?.accessPoint?.name,
      scan?.deviceId,
      scan ? (scan.offline ? "Sí" : "No") : "",
    ];
  });
  return csvResponse(`${slug}-asistentes.csv`, header, lines);
}
