"use server";

import { DEFAULT_TIMEZONE, formatCode, formatDateTime, zonedDateTimeToUtc } from "@ticketera/core";
import { parseProviderReport, paymentReconciliation } from "@ticketera/db";
import { ROLES, isGlobalView, requireStaff } from "@/lib/session";

export type ComparisonState =
  | {
      error?: string;
      result?: {
        matched: number;
        skipped: number;
        missingInSystem: { reference: string; amount: number }[];
        missingInReport: { reference: string | null; amount: number; order: string; at: string }[];
        amountMismatch: { reference: string; system: number; report: number; order: string }[];
      };
    }
  | undefined;

/**
 * Compara lo que el sistema dio por cobrado en el período contra el reporte de la pasarela (pegado como texto:
 * "referencia;monto" por línea). Marca lo que falta de un lado o del otro y los montos distintos.
 */
export async function compareProviderReportAction(_prev: ComparisonState, formData: FormData): Promise<ComparisonState> {
  const staff = await requireStaff(ROLES.manage);
  const from = String(formData.get("desde") ?? "");
  const to = String(formData.get("hasta") ?? "");
  const provider = String(formData.get("proveedor") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { error: "Elige el período." };
  if (!provider) return { error: "Escribe el nombre de la pasarela tal como figura en los pagos (ej. el de PAYMENT_PROVIDER)." };
  const { rows, skipped } = parseProviderReport(String(formData.get("reporte") ?? ""));
  if (rows.length === 0) return { error: "Pega el reporte: una línea por cobro, «referencia;monto»." };
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const data = await paymentReconciliation({
    organizationId: isGlobalView(staff) ? null : staff.organization.id,
    from: zonedDateTimeToUtc(`${from}T00:00`, DEFAULT_TIMEZONE),
    to: zonedDateTimeToUtc(`${next.toISOString().slice(0, 10)}T00:00`, DEFAULT_TIMEZONE),
    provider,
    report: rows,
  });
  const c = data.comparison!;
  return {
    result: {
      matched: c.matched,
      skipped,
      missingInSystem: c.missingInSystem,
      missingInReport: c.missingInReport.map((p) => ({
        reference: p.providerPaymentId,
        amount: p.amount,
        order: formatCode(p.order.code),
        at: p.approvedAt ? formatDateTime(p.approvedAt, DEFAULT_TIMEZONE) : "",
      })),
      amountMismatch: c.amountMismatch.map((m) => ({ ...m, order: formatCode(m.order) })),
    },
  };
}
