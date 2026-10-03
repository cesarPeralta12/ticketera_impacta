import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatCode, formatMoney } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { MOCK_PROVIDER, isMockEnabled } from "@/lib/payments";
import { mockGatewayAction } from "./actions";

export const metadata: Metadata = { title: "Pasarela de pago simulada", robots: { index: false } };

type Props = { params: Promise<{ paymentId: string }> };

const options = [
  {
    decision: "approve",
    label: "Aprobar pago",
    hint: "El webhook llega antes de volver al sitio.",
    className: "bg-indigo-600 text-white hover:bg-indigo-700",
  },
  {
    decision: "approve-late",
    label: "Aprobar con webhook demorado",
    hint: "Vuelves al sitio y la confirmación llega 5 segundos después.",
    className: "bg-white text-indigo-700 ring-1 ring-indigo-300 hover:bg-indigo-50",
  },
  {
    decision: "reject",
    label: "Rechazar pago",
    hint: "Fondos insuficientes, tarjeta bloqueada, etc.",
    className: "bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50",
  },
  {
    decision: "back",
    label: "Volver sin pagar",
    hint: "El pago queda pendiente; la reserva sigue corriendo.",
    className: "bg-white text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-50",
  },
] as const;

export default async function MockGatewayPage({ params }: Props) {
  if (!isMockEnabled()) notFound();
  await connection();

  const payment = await prisma.payment.findUnique({
    where: { id: (await params).paymentId },
    include: { order: true },
  });
  if (!payment || payment.provider !== MOCK_PROVIDER) notFound();

  return (
    <main className="mx-auto w-full max-w-md space-y-4 px-6 py-10">
      <div className="rounded-lg bg-indigo-950 px-4 py-2 text-center text-xs text-indigo-100">
        Pasarela simulada · solo desarrollo · se reemplaza por la pasarela real
      </div>
      <div className="overflow-hidden rounded-2xl border border-indigo-200 bg-white text-zinc-900 shadow-sm">
        <div className="bg-indigo-600 px-6 py-5 text-white">
          <p className="text-sm opacity-80">PagoSimulado</p>
          <p className="text-3xl font-semibold tabular-nums">{formatMoney(payment.amount, payment.currency)}</p>
          <p className="text-sm opacity-80">
            Impacta · Orden {formatCode(payment.order.code)}
          </p>
        </div>

        {payment.status !== "PENDING" ? (
          <div className="space-y-3 p-6">
            <p>Este pago ya fue procesado ({payment.status.toLowerCase()}).</p>
            <Link href={`/orden/${payment.order.code}`} className="font-medium text-indigo-700 underline">
              Volver al comercio
            </Link>
          </div>
        ) : (
          <div className="space-y-3 p-6">
            {options.map((option) => (
              <form key={option.decision} action={mockGatewayAction}>
                <input type="hidden" name="paymentId" value={payment.id} />
                <input type="hidden" name="decision" value={option.decision} />
                <button type="submit" className={`w-full rounded-lg px-4 py-3 text-left ${option.className}`}>
                  <span className="block font-medium">{option.label}</span>
                  <span className="block text-xs opacity-75">{option.hint}</span>
                </button>
              </form>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
