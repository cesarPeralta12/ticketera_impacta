import { DEFAULT_TIMEZONE, formatDateTime } from "@ticketera/core";
import { csvMoney, csvResponse } from "@/lib/csv";
import { CHANNEL_LABEL } from "@/lib/labels";
import { buyersDirectory } from "@/lib/sales";
import { ROLES, can, currentStaff, isGlobalView } from "@/lib/session";

/** Directorio de compradores para abrir en Excel: una fila por persona. */
export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff || !can(staff, ROLES.manage) || staff.limitedView) return Response.json({ error: "Sin permiso." }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const { buyers } = await buyersDirectory(staff, { q: params.get("q") ?? "", org: params.get("org") ?? "" });
  const global = isGlobalView(staff);

  const header = [
    "Nombre",
    "Email",
    "CI / NIT",
    "Compras",
    "Entradas",
    "Total gastado (Bs)",
    "Primera compra",
    "Última compra",
    "Canales",
    ...(global ? ["Organizadores"] : []),
    "Eventos",
  ];
  const rows = buyers.map((b) => [
    b.name,
    b.email,
    b.document,
    b.orders,
    b.tickets,
    csvMoney(b.total),
    formatDateTime(b.firstPurchase, DEFAULT_TIMEZONE),
    formatDateTime(b.lastPurchase, DEFAULT_TIMEZONE),
    b.channels.map((c) => CHANNEL_LABEL[c as keyof typeof CHANNEL_LABEL] ?? c).join(", "),
    ...(global ? [b.organizers.join(", ")] : []),
    b.events.join(", "),
  ]);
  const scope = global ? "todos" : staff.organization.slug;
  return csvResponse(`compradores-${scope}.csv`, header, rows);
}
