"use server";

import { redirect } from "next/navigation";
import { DOCUMENT_ERROR, checkoutSchema } from "@ticketera/core";
import { BOX_OFFICE_BUYER, DomainError, POS_METHODS, prisma, sellAtBoxOffice, type PosMethod } from "@ticketera/db";
import { ROLES, requireStaff } from "@/lib/session";

export type PosState = {
  error?: string;
  /** El inventario cambió (butaca tomada, agotado): refrescar el mapa. */
  refresh?: boolean;
};

/** Cobro en caja: emite las entradas al instante y lleva al ticket para imprimir. */
export async function sellAction(_prev: PosState, formData: FormData): Promise<PosState> {
  const staff = await requireStaff(ROLES.pos);
  const sessionId = String(formData.get("sessionId") ?? "");
  const method = String(formData.get("method") ?? "") as PosMethod;
  if (!POS_METHODS.includes(method)) return { error: "Elige cómo pagó el cliente." };

  const session = await prisma.eventSession.findFirst({
    where: { id: sessionId, event: { organizationId: staff.organization.id } },
  });
  if (!session) return { error: "Función no encontrada." };

  const items = [...formData.entries()].flatMap(([key, value]) => {
    if (typeof value !== "string") return [];
    if (key.startsWith("qty:") && Number(value) > 0) return [{ ticketTypeId: key.slice(4), quantity: Number(value) }];
    if (key.startsWith("seats:") && value) {
      const seatIds = value.split(",").filter(Boolean);
      return [{ ticketTypeId: key.slice(6), quantity: seatIds.length, seatIds }];
    }
    return [];
  });
  // En caja el nombre y el email son opcionales (quedan como "Venta en boletería"), pero el carnet
  // del cliente es obligatorio, igual que online: las entradas salen con ese carnet.
  const input = {
    sessionId,
    items,
    buyer: {
      name: String(formData.get("name") ?? "").trim() || BOX_OFFICE_BUYER.name,
      email: String(formData.get("email") ?? "").trim() || BOX_OFFICE_BUYER.email,
      document: String(formData.get("document") ?? ""),
    },
  };
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "buyer" && issue.path[1] === "document") return { error: DOCUMENT_ERROR };
    if (issue?.path[0] === "buyer") {
      return { error: "Revisa los datos del comprador: nombre de al menos 3 letras y email válido (o déjalos vacíos)." };
    }
    return { error: issue?.message ?? "Revisa las entradas." };
  }

  let code: string;
  try {
    ({ code } = await sellAtBoxOffice(input, { staffId: staff.id, method, promoCode: String(formData.get("promo") ?? "").trim() || undefined }));
  } catch (error) {
    if (error instanceof DomainError && error.code === "PROMO_INVALID") return { error: `Código promocional: ${error.message}` };
    if (error instanceof DomainError) {
      return { error: error.message, refresh: error.code === "SEAT_TAKEN" || error.code === "SOLD_OUT" };
    }
    throw error;
  }
  redirect(`/boleteria/ticket/${code}`);
}
