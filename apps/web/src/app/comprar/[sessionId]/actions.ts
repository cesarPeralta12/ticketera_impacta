"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkoutSchema } from "@ticketera/core";
import { DomainError, LIMITS, createPendingOrder, hit, prisma } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { activeProvider, isDirectPass, payDirect } from "@/lib/payments";
import { queueCookieName } from "@/lib/queue-cookie";

export type CheckoutState = {
  error?: string;
  /** El inventario cambió (butaca tomada, agotado): el cliente debe refrescar el mapa. */
  refresh?: boolean;
};

/**
 * Crea la orden. Comprar exige cuenta con carnet: nombre, email y carnet salen de la cuenta
 * (el formulario ya no los pide) y createPendingOrder vuelve a tomarlos de ahí.
 */
export async function createOrderAction(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const back = encodeURIComponent(`/comprar/${sessionId}`);

  const session = await auth();
  const customer = session?.user?.id
    ? await prisma.customer.findUnique({
        where: { id: session.user.id },
        select: { id: true, name: true, email: true, documentId: true, emailVerified: true },
      })
    : null;
  if (!customer) redirect(`/login?next=${back}`);
  if (!customer.emailVerified) redirect(`/cuenta/verificar?next=${back}`);
  if (!customer.documentId) redirect(`/cuenta/datos?next=${back}`);

  // Límite de reservas por cuenta: nadie acapara butacas creando órdenes sin pagar.
  if (!(await hit(`order:account:${customer.id}`, LIMITS.ordersByAccount))) {
    return { error: "Hiciste muchas reservas seguidas. Espera unos minutos o paga las que ya tienes." };
  }

  const items = [...formData.entries()].flatMap(([key, value]) => {
    if (typeof value !== "string") return [];
    if (key.startsWith("qty:") && Number(value) > 0) {
      return [{ ticketTypeId: key.slice(4), quantity: Number(value) }];
    }
    if (key.startsWith("seats:") && value) {
      const seatIds = value.split(",").filter(Boolean);
      return [{ ticketTypeId: key.slice(6), quantity: seatIds.length, seatIds }];
    }
    return [];
  });

  const parsed = checkoutSchema.safeParse({
    sessionId,
    items,
    buyer: { name: customer.name, email: customer.email, document: customer.documentId },
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa las entradas elegidas." };

  const queueToken = (await cookies()).get(queueCookieName(sessionId))?.value;

  let code: string;
  try {
    ({ code } = await createPendingOrder(parsed.data, { queueToken, customerId: customer.id }));
  } catch (error) {
    if (error instanceof DomainError) {
      if (error.code === "QUEUE_REQUIRED") redirect(`/comprar/${sessionId}/espera`);
      if (error.code === "LOGIN_REQUIRED") redirect(`/login?next=${back}`);
      if (error.code === "DOCUMENT_REQUIRED") redirect(`/cuenta/datos?next=${back}`);
      if (error.code === "EMAIL_NOT_VERIFIED") redirect(`/cuenta/verificar?next=${back}`);
      return { error: error.message, refresh: error.code === "SEAT_TAKEN" || error.code === "SOLD_OUT" };
    }
    throw error;
  }
  // Pase directo: se confirma en el mismo paso. Con una pasarela real, la orden queda reservada y la
  // página de la orden lleva a pagar. Si el pase falla, la orden sigue reservada y se puede pagar desde ahí.
  if (isDirectPass(activeProvider())) {
    try {
      await payDirect(code);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
  }
  redirect(`/orden/${code}`);
}
