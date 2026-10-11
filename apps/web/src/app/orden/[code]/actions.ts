"use server";

import { redirect } from "next/navigation";
import { DomainError, getOrderByCode, prisma, startPayment } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { sendTicketsEmail } from "@/lib/mail";
import { activeProvider, checkoutUrl, isDirectPass, payDirect } from "@/lib/payments";
import { logAudit } from "@/lib/audit";

export async function payOrderAction(formData: FormData) {
  const code = String(formData.get("code"));
  let url: string;
  try {
    if (isDirectPass()) {
      await payDirect(code);
      redirect(`/orden/${code}`);
    }
    url = checkoutUrl(await startPayment(code, activeProvider()));
  } catch (error) {
    // La orden venció o ya no es pagable: la página de la orden muestra el estado actual.
    if (error instanceof DomainError) redirect(`/orden/${code}`);
    throw error;
  }
  redirect(url);
}

export type ResendState = { error?: string; message?: string } | undefined;

/** El dueño de la compra puede pedir que le reenvíen las entradas a su correo (una vez por minuto). */
export async function resendTicketsAction(_prev: ResendState, formData: FormData): Promise<ResendState> {
  const session = await auth();
  const order = await getOrderByCode(String(formData.get("code") ?? ""));
  if (!session?.user?.id || !order || order.customerId !== session.user.id || order.status !== "PAID") {
    return { error: "No pudimos reenviar estas entradas." };
  }
  const recent = await prisma.auditLog.count({
    where: { action: "order.resend_tickets", entityId: order.id, createdAt: { gt: new Date(Date.now() - 60_000) } },
  });
  if (recent > 0) return { error: "Ya te las enviamos hace un momento. Espera un minuto y revisa tu carpeta de spam." };

  await logAudit({ actorType: "customer", actorId: session.user.id, action: "order.resend_tickets", entity: "Order", entityId: order.id });
  return (await sendTicketsEmail(order.code))
    ? { message: `Te las enviamos a ${order.buyerEmail}.` }
    : { error: "No pudimos enviar el correo ahora. Intenta de nuevo en unos minutos." };
}
