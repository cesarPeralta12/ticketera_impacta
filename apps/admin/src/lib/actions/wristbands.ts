"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatCode } from "@ticketera/core";
import {
  DomainError,
  addWristbandRead,
  confirmWristbandBatch,
  createWristbandBatch,
  discardWristbandBatch,
  removeWristbandRead,
  type WristbandReadResult,
} from "@ticketera/db";
import type { FormState } from "@/lib/forms";
import { ROLES, requireEditor, type Staff } from "@/lib/session";

const redeemStaff = (staff: Staff) => ({ id: staff.id, role: staff.role, organizationId: staff.organization.id });

/** El mensaje de un error previsto; los demás se propagan. */
function domainMessage(error: unknown) {
  if (error instanceof DomainError) return error.message;
  throw error;
}

export async function createWristbandBatchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor(ROLES.pos);
  const sessionId = String(formData.get("sessionId") ?? "");
  const expected = String(formData.get("expected") ?? "").trim();
  let id: string;
  try {
    const batch = await createWristbandBatch(redeemStaff(staff), {
      sessionId,
      ticketTypeId: String(formData.get("ticketTypeId") ?? ""),
      name: String(formData.get("name") ?? ""),
      mode: formData.get("mode") === "ACTIVATE_ON_SALE" ? "ACTIVATE_ON_SALE" : "VALID_ON_PRINT",
      prefix: String(formData.get("prefix") ?? ""),
      expected: expected ? Number(expected) : undefined,
    });
    id = batch.id;
  } catch (error) {
    return { error: domainMessage(error) };
  }
  redirect(`/boleteria/lotes/${sessionId}/${id}`);
}

const READ_ERRORS: Record<Extract<WristbandReadResult, { ok: false }>["reason"], (detail: string) => string> = {
  BATCH_CLOSED: () => "Este lote ya está cerrado.",
  INVALID_UID: () => "No se pudo leer el número de serie. Acércala de nuevo; los teléfonos y las tarjetas virtuales no sirven.",
  ALREADY_IN_BATCH: (n) => `Repetida: ya es la n.º ${n} de este lote.`,
  IN_OTHER_BATCH: (name) => `Ya está en el lote «${name}».`,
  UID_IN_USE: (code) => `Ya está vinculada a la entrada ${formatCode(code)}.`,
  FULL: () => "No quedan lugares de este tipo de entrada: no entra ninguna más.",
};

export type ReadState = { ok: true; id: string; uid: string; count: number } | { ok: false; error: string; repeated: boolean };

/** Una manilla leída con el teléfono o el lector USB. */
export async function addWristbandReadAction(input: { batchId: string; uid: string; source: "PHONE" | "USB" }): Promise<ReadState> {
  const staff = await requireEditor(ROLES.pos);
  try {
    const result = await addWristbandRead(redeemStaff(staff), String(input.batchId), {
      uid: String(input.uid),
      card: { tech: [input.source === "PHONE" ? "NFC del teléfono (web)" : "Lector USB (web)"] },
    });
    if (result.ok) return result;
    return { ok: false, error: READ_ERRORS[result.reason](result.detail ?? ""), repeated: result.reason === "ALREADY_IN_BATCH" };
  } catch (error) {
    return { ok: false, error: domainMessage(error), repeated: false };
  }
}

export type BatchState = { ok: true; message?: string } | { ok: false; error: string };

export async function removeWristbandReadAction(batchId: string, itemId: string): Promise<BatchState> {
  const staff = await requireEditor(ROLES.pos);
  try {
    await removeWristbandRead(redeemStaff(staff), String(batchId), String(itemId));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: domainMessage(error) };
  }
}

export async function confirmWristbandBatchAction(batchId: string): Promise<BatchState> {
  const staff = await requireEditor(ROLES.pos);
  try {
    const done = await confirmWristbandBatch(redeemStaff(staff), String(batchId));
    revalidatePath("/boleteria/lotes", "layout");
    return { ok: true, message: `Listo: ${done.quantity} manillas cargadas.` };
  } catch (error) {
    return { ok: false, error: domainMessage(error) };
  }
}

export async function discardWristbandBatchAction(batchId: string): Promise<BatchState> {
  const staff = await requireEditor(ROLES.pos);
  try {
    await discardWristbandBatch(redeemStaff(staff), String(batchId));
    revalidatePath("/boleteria/lotes", "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: domainMessage(error) };
  }
}
