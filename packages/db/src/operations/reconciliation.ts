/**
 * Conciliación de cobros: lo que el sistema dio por cobrado, día por día y por medio, y lo que conviene revisar
 * (pagos sin entradas, cobros dobles, ventas pagadas sin pago, cobros QR abandonados). Con el reporte de la pasarela
 * (referencia y monto de cada cobro) se marcan también las diferencias contra lo que dice el banco.
 */
import { DEFAULT_TIMEZONE, utcToZonedInput } from "@ticketera/core";
import { prisma } from "../client";
import type { Prisma } from "../generated/prisma/client";

/** Un cobro tal como lo informa la pasarela en su reporte. */
export type ProviderRow = { reference: string; amount: number };

/** Lee el reporte de la pasarela pegado como texto: una línea por cobro, "referencia;monto" (o con coma o tabulador). */
export function parseProviderReport(text: string): { rows: ProviderRow[]; skipped: number } {
  const rows: ProviderRow[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[;\t]|,(?=\s*-?\d)/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 2 || !cells[0]) continue;
    // "150", "150.50" o "150,50" bolivianos -> centavos. Los títulos ("referencia;monto") no son números: se saltan.
    const amount = Number(cells[1]!.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    if (!Number.isFinite(amount)) {
      skipped++;
      continue;
    }
    rows.push({ reference: cells[0]!, amount: Math.round(amount * 100) });
  }
  return { rows, skipped };
}

export async function paymentReconciliation(input: { organizationId: string | null; from: Date; to: Date; provider?: string; report?: ProviderRow[]; now?: Date }) {
  const now = input.now ?? new Date();
  const inOrg: Prisma.OrderWhereInput = input.organizationId ? { items: { some: { ticketType: { session: { event: { organizationId: input.organizationId } } } } } } : {};
  const period = { gte: input.from, lt: input.to };
  const orderSelect = { code: true, status: true, channel: true, buyerName: true, totalAmount: true, currency: true, paidAt: true } as const;

  const [approved, refunded, approvedWithoutTickets, doubles, paidWithoutPayment, abandoned, voided] = await Promise.all([
    prisma.payment.findMany({
      where: { status: { in: ["APPROVED", "REFUNDED"] }, approvedAt: period, order: inOrg, ...(input.provider ? { provider: input.provider } : {}) },
      select: { id: true, provider: true, providerPaymentId: true, amount: true, currency: true, approvedAt: true, status: true, order: { select: orderSelect } },
      orderBy: { approvedAt: "asc" },
    }),
    prisma.payment.findMany({
      where: { status: "REFUNDED", updatedAt: period, order: inOrg },
      select: { id: true, provider: true, amount: true, currency: true, updatedAt: true, order: { select: { ...orderSelect, voidReason: true } } },
    }),
    // Pago aprobado de una orden que no quedó pagada (llegó tarde y ya no había lugar): hay que devolverlo. Las que un
    // administrador anuló a propósito van aparte (voided).
    prisma.payment.findMany({
      where: { status: "APPROVED", approvedAt: period, order: { ...inOrg, voidedAt: null, status: { notIn: ["PAID", "PARTIALLY_REFUNDED"] } } },
      select: { id: true, provider: true, providerPaymentId: true, amount: true, currency: true, approvedAt: true, order: { select: orderSelect } },
    }),
    prisma.order.findMany({
      where: { ...inOrg, paidAt: period, payments: { some: { status: "APPROVED" } } },
      select: { ...orderSelect, payments: { where: { status: "APPROVED" }, select: { id: true, provider: true, amount: true } } },
    }),
    // Venta que figura pagada sin ningún pago aprobado (las invitaciones, impresas e importadas no pasan por un pago).
    prisma.order.findMany({
      where: { ...inOrg, status: "PAID", paidAt: period, channel: { in: ["ONLINE", "POS", "PROMOTER"] }, payments: { none: { status: "APPROVED" } } },
      select: orderSelect,
    }),
    // Cobros QR que se abrieron y nunca se pagaron (más de 30 minutos): no son dinero, solo para saber.
    prisma.payment.findMany({
      where: { status: "PENDING", createdAt: { ...period, lt: new Date(Math.min(input.to.getTime(), now.getTime() - 30 * 60_000)) }, order: { ...inOrg, status: { not: "PAID" } } },
      select: { id: true, provider: true, amount: true, currency: true, createdAt: true, order: { select: orderSelect } },
      take: 200,
    }),
    // Ventas anuladas por un administrador en el período (sin devolución registrada): si se había cobrado, revisar.
    prisma.order.findMany({
      where: { ...inOrg, status: "CANCELLED", voidedAt: period },
      select: { ...orderSelect, voidReason: true, payments: { where: { status: "APPROVED" }, select: { provider: true, amount: true } } },
    }),
  ]);

  // Lo cobrado por día (hora de Bolivia) y por medio.
  const byDay = new Map<string, { day: string; provider: string; count: number; amount: number; currency: string }>();
  for (const p of approved) {
    if (!p.approvedAt) continue;
    const day = utcToZonedInput(p.approvedAt, DEFAULT_TIMEZONE).slice(0, 10);
    const key = `${day}|${p.provider}`;
    const row = byDay.get(key) ?? { day, provider: p.provider, count: 0, amount: 0, currency: p.currency };
    byDay.set(key, { ...row, count: row.count + 1, amount: row.amount + p.amount });
  }

  // Contra el reporte de la pasarela: por referencia del cobro.
  let comparison: {
    missingInSystem: ProviderRow[];
    missingInReport: typeof approved;
    amountMismatch: { reference: string; system: number; report: number; order: string }[];
    matched: number;
  } | null = null;
  if (input.report) {
    const ours = new Map(approved.flatMap((p) => (p.providerPaymentId ? [[p.providerPaymentId, p] as const] : [])));
    const theirs = new Map(input.report.map((r) => [r.reference, r]));
    comparison = {
      missingInSystem: input.report.filter((r) => !ours.has(r.reference)),
      missingInReport: approved.filter((p) => !p.providerPaymentId || !theirs.has(p.providerPaymentId)),
      amountMismatch: input.report.flatMap((r) => {
        const p = ours.get(r.reference);
        return p && p.amount !== r.amount ? [{ reference: r.reference, system: p.amount, report: r.amount, order: p.order.code }] : [];
      }),
      matched: input.report.filter((r) => ours.get(r.reference)?.amount === r.amount).length,
    };
  }

  return {
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day) || a.provider.localeCompare(b.provider)),
    totals: { count: approved.length, amount: approved.reduce((sum, p) => sum + p.amount, 0) },
    issues: {
      approvedWithoutTickets,
      doubles: doubles.filter((o) => o.payments.length > 1),
      paidWithoutPayment,
      abandoned,
      refunded,
      voided,
    },
    comparison,
  };
}
