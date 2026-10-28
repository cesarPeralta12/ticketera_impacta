import { csvMoney, csvResponse } from "@/lib/csv";
import { listSales, readSalesFilters, salesExport } from "@/lib/sales";
import { ROLES, can, currentStaff, isGlobalView } from "@/lib/session";

/** Ventas con los mismos filtros de la pantalla, en CSV (se abre en Excel). */
export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff || !can(staff, ROLES.manage)) return Response.json({ error: "Sin permiso." }, { status: 403 });
  const filters = readSalesFilters(new URL(req.url).searchParams);
  const global = isGlobalView(staff);
  const { header, rows, moneyColumns } = salesExport(await listSales(staff, filters, 50_000), global);
  const scope = global ? "todos" : staff.organization.slug;
  return csvResponse(
    `ventas-${scope}.csv`,
    header,
    rows.map((row) => row.map((cell, i) => (moneyColumns.has(i) && typeof cell === "number" ? csvMoney(cell) : cell))),
  );
}
