"use server";

import { revalidatePath } from "next/cache";
import { DomainError, voidOrder } from "@ticketera/db";
import type { FormState } from "@/lib/forms";
import { isGlobalView, requireEditor } from "@/lib/session";

/**
 * Anular o devolver una venta: solo un administrador (iPass), siempre con motivo; queda en el registro de seguridad.
 * Las entradas dejan de valer y su lugar vuelve a la venta.
 */
export async function voidOrderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const code = String(formData.get("code") ?? "");
  const refund = formData.get("kind") === "refund";
  try {
    await voidOrder({
      orderCode: code,
      organizationId: isGlobalView(staff) ? null : staff.organization.id,
      staffId: staff.id,
      reason: String(formData.get("reason") ?? ""),
      refund,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/ordenes/${code}`);
  revalidatePath("/ordenes");
  return { ok: true, message: refund ? "Devolución registrada: las entradas ya no valen." : "Venta anulada: las entradas ya no valen." };
}
