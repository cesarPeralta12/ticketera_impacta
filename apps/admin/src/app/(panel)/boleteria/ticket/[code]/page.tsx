import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatCode, formatDateTime, formatMoney } from "@ticketera/core";
import { BOX_OFFICE_BUYER, getOrderByCode, prisma } from "@ticketera/db";
import { PrintButton } from "@/components/print-button";
import { ticketQrSvg } from "@/lib/qr";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ticket" };

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ formato?: string }> };

const METHOD_LABEL: Record<string, string> = { pos_efectivo: "Efectivo", pos_qr: "QR", pos_tarjeta: "Tarjeta" };

/** Ticket de boletería: uno por entrada, con su QR, para impresora térmica de 80 mm o A4. */
export default async function PosTicketPage({ params, searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.pos);
  const order = await getOrderByCode((await params).code.toUpperCase());
  const session = order?.items[0]?.ticketType.session;
  if (!order || !session || order.channel !== "POS" || session.event.organizationId !== staff.organization.id) {
    notFound();
  }
  const a4 = (await searchParams).formato === "a4";
  const cashier = order.issuedById
    ? await prisma.staffUser.findUnique({ where: { id: order.issuedById }, select: { name: true } })
    : null;
  const payment = order.payments.find((p) => p.status === "APPROVED");
  const tz = session.venue.timezone;
  const tickets = await Promise.all(
    order.tickets.map(async (t) => ({
      ...t,
      qr: await ticketQrSvg(t.code),
      price: order.items.find((i) => i.id === t.orderItemId)?.unitAmount ?? 0,
    })),
  );
  const buyer = order.buyerName === BOX_OFFICE_BUYER.name ? null : order.buyerName;

  return (
    <div className="space-y-6">
      {/* Papel del ticket: rollo térmico de 80 mm (un ticket por corte) o A4. */}
      <style>{a4 ? "@page { size: A4; margin: 12mm; }" : "@page { size: 80mm auto; margin: 3mm; }"}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <p className="eyebrow">Venta {formatCode(order.code)}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Venta registrada</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {tickets.length} entrada(s) · {formatMoney(order.totalAmount, order.currency)} ·{" "}
            {METHOD_LABEL[payment?.provider ?? ""] ?? "—"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={a4 ? "?" : "?formato=a4"} className="btn text-xs">
            {a4 ? "Formato térmico 80 mm" : "Formato A4"}
          </Link>
          <Link href={`/boleteria/${session.id}`} className="btn">
            Nueva venta
          </Link>
          <PrintButton label="Imprimir ticket" />
        </div>
      </div>

      <ul className={a4 ? "grid grid-cols-2 gap-4 print:gap-3" : "flex flex-col items-center gap-4 print:block"}>
        {tickets.map((t, i) => (
          <li
            key={t.id}
            className={`bg-white text-center text-[#14181b] ${
              a4
                ? "break-inside-avoid rounded-lg border border-dashed border-[#9a9c92] p-5"
                : "w-[74mm] rounded-md border border-[var(--border)] p-3 shadow-sm print:break-after-page print:rounded-none print:border-0 print:p-0 print:shadow-none"
            }`}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.2em]">{staff.organization.name}</p>
            <p className="mt-1 text-base font-bold leading-tight">{session.event.title}</p>
            <p className="text-xs">{formatDateTime(session.startsAt, tz)}</p>
            <p className="text-xs">{session.venue.name}</p>
            <div className="my-2 border-t border-dashed border-[#14181b]" />
            <p className="text-sm font-semibold">{t.ticketType.name}</p>
            {t.seat && (
              <p className="text-sm font-bold">
                {t.seat.section.name} · {t.seat.label}
              </p>
            )}
            <div className="mx-auto my-2 w-[46mm]" dangerouslySetInnerHTML={{ __html: t.qr }} />
            <p className="font-mono text-sm tracking-wider">{formatCode(t.code)}</p>
            <p className="text-[10px]">
              Entrada {i + 1} de {tickets.length} · {formatMoney(t.price, order.currency)}
            </p>
            {buyer && <p className="text-[10px]">{buyer}</p>}
            <div className="my-2 border-t border-dashed border-[#14181b]" />
            <p className="text-[10px] leading-snug">
              Venta {formatCode(order.code)} · {METHOD_LABEL[payment?.provider ?? ""] ?? "—"}
              <br />
              {order.paidAt && formatDateTime(order.paidAt, tz)} · Cajero: {cashier?.name ?? "—"}
              <br />
              Válida para un ingreso. No la compartas: el QR se anula al entrar.
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
