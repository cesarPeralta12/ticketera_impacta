import { listSales, readSalesFilters, salesExport, salesSummary } from "@/lib/sales";
import { ROLES, can, currentStaff, isGlobalView } from "@/lib/session";
import { xlsx } from "@/lib/xlsx";

/** Ventas con los mismos filtros de la pantalla, en Excel: el detalle venta por venta y una hoja con los resúmenes. */
export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff || !can(staff, ROLES.manage)) return Response.json({ error: "Sin permiso." }, { status: 403 });
  const filters = readSalesFilters(new URL(req.url).searchParams);
  const global = isGlobalView(staff);
  const [orders, summary] = await Promise.all([listSales(staff, filters, 50_000), salesSummary(staff, filters)]);
  const { header, rows, moneyColumns } = salesExport(orders, global);
  const bs = (cents: number) => Math.round(cents) / 100;
  const file = xlsx([
    {
      name: "Ventas",
      header: true,
      rows: [header, ...rows.map((row) => row.map((cell, i) => (moneyColumns.has(i) && typeof cell === "number" ? bs(cell) : cell)))],
      widths: header.map((h) => Math.max(12, Math.min(40, h.length + 4))),
    },
    {
      name: "Resumen",
      header: true,
      rows: [
        ["Resumen (solo ventas pagadas)", "Ventas", "Total (Bs)"],
        ["Total", summary.count, bs(summary.amount)],
        [],
        ["Por vendedor", "Ventas", "Total (Bs)"],
        ...summary.bySeller.map((s) => [s.name, s.count, bs(s.amount)]),
        [],
        ["Por medio de cobro", "Pagos", "Total (Bs)"],
        ...summary.byMethod.map((m) => [m.name, m.count, bs(m.amount)]),
      ],
      widths: [40, 10, 16],
    },
  ]);
  const scope = global ? "todos" : staff.organization.slug;
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ventas-${scope}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
