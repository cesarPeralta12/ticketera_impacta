import { formatCode, formatDateTime } from "@ticketera/core";
import { BOX_OFFICE_BUYER, listEventAttendees } from "@ticketera/db";
import { CHANNEL_LABEL } from "./labels";

/**
 * Celda CSV con punto y coma (lo que Excel en español abre directo). Lo que empieza con
 * =, +, - o @ se antepone con ' para que Excel no lo ejecute como fórmula: los nombres
 * los escriben los compradores.
 */
function cell(value: string | null | undefined) {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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
      t.holderDocument ?? t.order.buyerDocument,
      CHANNEL_LABEL[t.order.channel],
      t.ticketType.name,
      t.ticketType.section?.name,
      t.seat?.label,
      t.status === "USED" ? "Ingresó" : "No ingresó",
      t.usedAt ? formatDateTime(t.usedAt, tz) : "",
      scan?.accessPoint?.name,
      scan?.deviceId,
      scan ? (scan.offline ? "Sí" : "No") : "",
    ]
      .map(cell)
      .join(";");
  });
  // BOM: sin él, Excel muestra mal los acentos.
  const body = `﻿${[header.join(";"), ...lines].join("\r\n")}\r\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-asistentes.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
