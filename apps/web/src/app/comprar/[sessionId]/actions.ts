"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkoutSchema } from "@ticketera/core";
import { DomainError, createPendingOrder } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { queueCookieName } from "@/lib/queue-cookie";

export type CheckoutState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "document", string>>;
  /** El inventario cambió (butaca tomada, agotado): el cliente debe refrescar el mapa. */
  refresh?: boolean;
};

export async function createOrderAction(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const sessionId = String(formData.get("sessionId") ?? "");
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
    buyer: {
      name: formData.get("name") ?? "",
      email: formData.get("email") ?? "",
      document: formData.get("document") ?? "",
    },
  });
  if (!parsed.success) {
    const fieldErrors: CheckoutState["fieldErrors"] = {};
    let error: string | undefined;
    for (const issue of parsed.error.issues) {
      const [scope, field] = issue.path;
      if (scope === "buyer" && (field === "name" || field === "email" || field === "document")) {
        fieldErrors[field] ??= issue.message;
      } else {
        error ??= issue.message;
      }
    }
    return { error, fieldErrors };
  }

  const session = await auth();
  const queueToken = (await cookies()).get(queueCookieName(sessionId))?.value;

  let code: string;
  try {
    ({ code } = await createPendingOrder(parsed.data, { queueToken, customerId: session?.user?.id }));
  } catch (error) {
    if (error instanceof DomainError) {
      if (error.code === "QUEUE_REQUIRED") redirect(`/comprar/${sessionId}/espera`);
      return { error: error.message, refresh: error.code === "SEAT_TAKEN" || error.code === "SOLD_OUT" };
    }
    throw error;
  }
  redirect(`/orden/${code}`);
}
