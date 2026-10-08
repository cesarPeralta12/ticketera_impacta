import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { code128Svg, formatCode, formatDateTime, formatMoney } from "@ticketera/core";
import { BOX_OFFICE_BUYER, getOrderByCode, prisma } from "@ticketera/db";
import { PrintButton } from "@/components/print-button";
import { ticketQrSvg } from "@/lib/qr";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ticket" };

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ formato?: string }> };

type PaperFormat = "termico" | "a4" | "carta";

const FORMAT_LABEL: Record<PaperFormat, string> = { termico: "Térmico 80 mm", a4: "A4", carta: "Carta" };

/**
 * Tamaño de hoja al imprimir o "Guardar como PDF". Chrome ignora `size: 80mm auto` (el alto no puede ser
 * "auto") y cae en Carta, así que el ticket térmico lleva un alto fijo: una entrada por hoja de 80 × 150 mm.
 */
const PAGE_CSS: Record<PaperFormat, string> = {
  termico: "@page { size: 80mm 150mm; margin: 3mm; }",
  a4: "@page { size: A4; margin: 12mm; }",
  carta: "@page { size: letter; margin: 12mm; }",
};

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
  const requested = (await searchParams).formato;
  const format: PaperFormat = requested === "a4" || requested === "carta" ? requested : "termico";
  // Térmico = un ticket por hoja de 80 mm; A4 y carta = varios tickets por hoja.
  const sheet = format !== "termico";
  const cashier = order.issuedById
    ? await prisma.staffUser.findUnique({ where: { id: order.issuedById }, select: { name: true } })
    : null;
  const payment = order.payments.find((p) => p.status === "APPROVED");
  const tz = session.venue.timezone;
  const tickets = await Promise.all(
    order.tickets.map(async (t) => ({
      ...t,
      qr: t.ticketType.accessMethods.includes("QR") ? await ticketQrSvg(t.code) : null,
      // Código de barras: lo lee cualquier lector láser, ideal para el ticket térmico.
      barcode: t.ticketType.accessMethods.includes("BARCODE") ? code128Svg(t.code, { height: 48 }) : null,
      price: order.items.find((i) => i.id === t.orderItemId)?.unitAmount ?? 0,
    })),
  );
  const buyer = order.buyerName === BOX_OFFICE_BUYER.name ? null : order.buyerName;

  return (
    <div className="space-y-6">
      {/* Papel del ticket: rollo térmico de 80 mm (un ticket por corte) o A4. */}
      <style>{PAGE_CSS[format]}</style>

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
          <div className="flex overflow-hidden rounded-md border border-[var(--border)] text-xs" role="group" aria-label="Formato de papel">
            {(Object.keys(FORMAT_LABEL) as PaperFormat[]).map((f) => (
              <Link
                key={f}
                href={f === "termico" ? "?" : `?formato=${f}`}
                className={`px-3 py-2 ${f === format ? "bg-[var(--ink)] text-white" : "bg-[var(--surface)] hover:bg-[var(--surface-2)]"}`}
              >
                {FORMAT_LABEL[f]}
              </Link>
            ))}
          </div>
          <Link href={`/boleteria/${session.id}`} className="btn">
            Nueva venta
          </Link>
          <PrintButton label="Imprimir ticket" />
        </div>
      </div>

      <ul className={sheet ? "grid grid-cols-2 gap-4 print:gap-3" : "flex flex-col items-center gap-4 print:block"}>
        {tickets.map((t, i) => (
          <li
            key={t.id}
            className={`bg-white text-center text-[#14181b] ${
              sheet
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
            {t.qr && <div className="mx-auto my-2 w-[46mm]" dangerouslySetInnerHTML={{ __html: t.qr }} />}
            {t.barcode && (
              <div className="mx-auto my-2 w-[60mm] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: t.barcode }} />
            )}
            {t.ticketType.accessMethods.includes("NFC") && !t.qr && !t.barcode && (
              <p className="my-2 text-xs font-semibold">Se lee por NFC</p>
            )}
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
