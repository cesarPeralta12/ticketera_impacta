import { DEFAULT_TIMEZONE, formatCode, formatDateTime } from "@ticketera/core";
import { BOX_OFFICE_BUYER } from "@ticketera/db";
import { csvMoney, csvResponse } from "@/lib/csv";
import { CHANNEL_LABEL } from "@/lib/labels";
import { listSales } from "@/lib/sales";
import { ROLES, can, currentStaff, isGlobalView } from "@/lib/session";

const STATUS: Record<string, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagada",
  EXPIRED: "Expirada",
  CANCELLED: "Cancelada",
  REFUNDED: "Reembolsada",
  PARTIALLY_REFUNDED: "Reembolso parcial",
};
const METHOD: Record<string, string> = {
  pos_efectivo: "Efectivo (caja)",
  pos_qr: "QR (caja)",
  pos_tarjeta: "Tarjeta (caja)",
  mock: "Pasarela (simulada)",
};

/** Ventas con los mismos filtros de la pantalla, para abrir en Excel. */
export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff || !can(staff, ROLES.manage)) return Response.json({ error: "Sin permiso." }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const filters = { q: params.get("q") ?? "", estado: params.get("estado") ?? "", org: params.get("org") ?? "" };
  const orders = await listSales(staff, filters, 50_000);
  const global = isGlobalView(staff);

  const header = [
    "Fecha",
    "Orden",
    "Estado",
    "Canal",
    "Medio de pago",
    "Comprador",
    "Email",
    "CI / NIT",
    ...(global ? ["Organizador"] : []),
    "Evento",
    "Función",
    "Detalle",
    "Entradas",
    "Total (Bs)",
  ];
  const rows = orders.map((o) => {
    const session = o.items[0]?.ticketType.session;
    const tz = session?.venue.timezone ?? DEFAULT_TIMEZONE;
    const approved = o.payments.find((p) => p.status === "APPROVED") ?? o.payments[0];
    return [
      formatDateTime(o.createdAt, tz),
      formatCode(o.code),
      STATUS[o.status] ?? o.status,
      CHANNEL_LABEL[o.channel],
      approved ? (METHOD[approved.provider] ?? approved.provider) : "",
      o.buyerName,
      o.buyerEmail === BOX_OFFICE_BUYER.email ? "" : o.buyerEmail,
      o.buyerDocument,
      ...(global ? [session?.event.organization.name] : []),
      session?.event.title,
      session ? formatDateTime(session.startsAt, tz) : "",
      o.items.map((i) => `${i.quantity} x ${i.name}`).join(", "),
      o._count.tickets,
      csvMoney(o.totalAmount),
    ];
  });
  const scope = global ? "todos" : staff.organization.slug;
  return csvResponse(`ventas-${scope}.csv`, header, rows);
}
