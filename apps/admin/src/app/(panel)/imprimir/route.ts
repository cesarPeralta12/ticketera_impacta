import { formatMoney, serialNumber, signTicketPayload, tableLabel, whenWhere } from "@ticketera/core";
import { prisma, recordPrinting, requireEnv, type Prisma } from "@ticketera/db";
import { PAPER_FORMATS, ticketsPdf, type PaperFormat, type PrintableTicket } from "@/lib/print/tickets-pdf";
import { ROLES, can, currentStaff } from "@/lib/session";

/** Qué entradas de una función se imprimen. */
const SCOPES = {
  todas: {},
  online: { order: { channel: "ONLINE" } },
  boleteria: { order: { channel: "POS" } },
  invitaciones: { order: { channel: "GUEST" } },
  impresas: { printBatchId: { not: null } },
  importadas: { order: { channel: "IMPORT" } },
} satisfies Record<string, Prisma.TicketWhereInput>;

const MAX_TICKETS = 2000;

/**
 * PDF de entradas para imprimir:
 *   /imprimir?lote=<id>[&desde=1&hasta=20][&formato=carta3][&arte=0][&csv=1]
 *   /imprimir?funcion=<id>[&tipo=<id>][&alcance=todas|online|boleteria|invitaciones|impresas|importadas][&orden=serie|nombre][&formato=…]
 *   /imprimir?importacion=<id>[&formato=…]   (las entradas de una importación desde Excel)
 * Solo quien administra el evento (no las cuentas de solo lectura). Cada impresión y reimpresión queda en Seguridad.
 */
export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff || !can(staff, ROLES.manage)) return Response.json({ error: "Sin permiso." }, { status: 403 });
  if (staff.readOnly) return Response.json({ error: "Tu cuenta es de solo lectura: imprimir entradas lo hace iPass." }, { status: 403 });

  const url = new URL(req.url);
  const q = (name: string) => url.searchParams.get(name) ?? undefined;
  const format = (PAPER_FORMATS as readonly string[]).includes(q("formato") ?? "") ? (q("formato") as PaperFormat) : "carta3";
  const org = { event: { organizationId: staff.organization.id } };

  let where: Prisma.TicketWhereInput;
  let batch: Awaited<ReturnType<typeof prisma.printBatch.findFirst<{ include: { art: true } }>>> = null;
  let range: { from: number; to: number } | null = null;
  if (q("lote")) {
    batch = await prisma.printBatch.findFirst({ where: { id: q("lote"), session: org }, include: { art: true } });
    if (!batch) return Response.json({ error: "Lote no encontrado." }, { status: 404 });
    where = { printBatchId: batch.id, status: { not: "CANCELLED" } };
    const from = Number(q("desde"));
    const to = Number(q("hasta") ?? q("desde"));
    if (Number.isInteger(from) && from > 0 && Number.isInteger(to) && to >= from) range = { from, to };
  } else if (q("importacion")) {
    const imported = await prisma.importBatch.findFirst({ where: { id: q("importacion"), event: { organizationId: staff.organization.id } }, select: { id: true } });
    if (!imported) return Response.json({ error: "Importación no encontrada." }, { status: 404 });
    where = { order: { importBatchId: imported.id }, status: { not: "CANCELLED" } };
  } else if (q("funcion")) {
    const session = await prisma.eventSession.findFirst({ where: { id: q("funcion"), ...org }, select: { id: true } });
    if (!session) return Response.json({ error: "Función no encontrada." }, { status: 404 });
    const scope = SCOPES[(q("alcance") ?? "todas") as keyof typeof SCOPES] ?? SCOPES.todas;
    where = { sessionId: session.id, status: { not: "CANCELLED" }, ...scope, ...(q("tipo") ? { ticketTypeId: q("tipo") } : {}) };
  } else {
    return Response.json({ error: "Falta el lote o la función." }, { status: 400 });
  }

  let tickets = await prisma.ticket.findMany({
    where: { ...where, ticketType: { qrMode: "STATIC" } },
    orderBy: q("orden") === "nombre" ? [{ holderName: "asc" }, { issuedAt: "asc" }] : [{ serial: "asc" }, { issuedAt: "asc" }],
    take: MAX_TICKETS + 1,
    include: {
      ticketType: { select: { name: true, unitAmount: true, currency: true, accessMethods: true } },
      seat: { include: { section: { select: { name: true } } } },
      credit: { select: { tableNumber: true, seat: { select: { label: true } } } },
      order: { select: { channel: true, buyerName: true } },
      session: { include: { event: { include: { organization: { select: { name: true } } } }, venue: true } },
    },
  });
  if (tickets.length > MAX_TICKETS) return Response.json({ error: `Son más de ${MAX_TICKETS} entradas: imprime por tipo o por rango.` }, { status: 400 });
  if (range && batch) {
    tickets = tickets.filter((t) => {
      const n = t.serial ? serialNumber(t.serial, batch!.prefix) : null;
      return n !== null && n >= range!.from && n <= range!.to;
    });
  }
  if (tickets.length === 0) return Response.json({ error: "No hay entradas para imprimir con ese filtro." }, { status: 404 });

  // Lista para la imprenta (datos variables): serie, código y lo que va en el QR.
  if (q("csv") === "1") {
    const secret = requireEnv("TICKET_QR_SECRET");
    const rows = ["serie;codigo;qr;tipo"];
    for (const t of tickets) rows.push([t.serial ?? "", t.code, await signTicketPayload(t.code, secret), t.ticketType.name].join(";"));
    await recordPrinting({ ticketIds: tickets.map((t) => t.id), staffId: staff.id, scope: "csv-imprenta" });
    return new Response(`﻿${rows.join("\r\n")}\r\n`, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="entradas-${batch?.prefix ?? "funcion"}.csv"`, "Cache-Control": "no-store" },
    });
  }

  const secret = requireEnv("TICKET_QR_SECRET");
  const printable: PrintableTicket[] = await Promise.all(
    tickets.map(async (t) => {
      const ww = whenWhere({ session: t.session, venue: t.session.venue, event: t.session.event });
      const printed = t.order.channel === "PRINTED";
      return {
        code: t.code,
        qrPayload: await signTicketPayload(t.code, secret),
        serial: t.serial,
        orgName: t.session.event.organization.name,
        eventTitle: t.session.event.title,
        dayLine: ww.when.day.charAt(0).toUpperCase() + ww.when.day.slice(1),
        timeLine: [ww.when.doors, ww.when.start, ww.when.lastEntry].filter(Boolean).join(" · "),
        venueLine: [ww.place.name, ww.place.address].filter(Boolean).join(" · "),
        typeName: t.ticketType.name,
        priceLabel: printed && batch ? formatMoney(batch.unitAmount, batch.currency) : null,
        holder: printed ? null : t.holderName ?? t.order.buyerName,
        seat: tableLabel(t.ticketType.name, t.credit?.tableNumber, t.credit?.seat?.label) ?? (t.seat ? `${t.seat.section.name} · ${t.seat.label}` : null),
        conditions: ww.conditions.slice(0, 2),
        barcode: t.ticketType.accessMethods.includes("BARCODE"),
      };
    }),
  );
  const art = batch?.art && q("arte") !== "0" ? { bytes: new Uint8Array(batch.art.data), mimeType: batch.art.mimeType } : null;
  const pdf = await ticketsPdf(printable, format, art);
  await recordPrinting({ ticketIds: tickets.map((t) => t.id), staffId: staff.id, scope: batch ? `lote ${batch.prefix}` : "funcion" });
  const name = batch ? `entradas-${batch.prefix}${range ? `-${range.from}-${range.to}` : ""}` : "entradas";
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}-${format}.pdf"`, "Cache-Control": "no-store" },
  });
}
