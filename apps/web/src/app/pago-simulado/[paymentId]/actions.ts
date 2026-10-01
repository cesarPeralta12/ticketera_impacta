"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@ticketera/db";
import { MOCK_PROVIDER, isMockEnabled, sendMockWebhook } from "@/lib/payments";

/**
 * Acciones de la pasarela simulada. Imitan lo que hace una pasarela real: el comprador
 * decide en la página de la pasarela, la pasarela avisa al comercio por webhook y luego
 * devuelve al comprador al sitio.
 */
export async function mockGatewayAction(formData: FormData) {
  if (!isMockEnabled()) throw new Error("Pasarela simulada deshabilitada.");

  const payment = await prisma.payment.findUnique({
    where: { id: String(formData.get("paymentId")) },
    include: { order: { select: { code: true } } },
  });
  if (!payment || payment.provider !== MOCK_PROVIDER) throw new Error("Pago no encontrado.");

  const decision = String(formData.get("decision"));
  const notify = (status: "approved" | "rejected") =>
    sendMockWebhook({ id: payment.id, amount: payment.amount, currency: payment.currency, status });

  if (payment.status === "PENDING") {
    if (decision === "approve") await notify("approved");
    if (decision === "reject") await notify("rejected");
    if (decision === "approve-late") {
      // El comprador vuelve al sitio antes de que llegue el webhook (caso habitual en pasarelas reales).
      after(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await notify("approved");
      });
    }
  }
  redirect(`/orden/${payment.order.code}`);
}
