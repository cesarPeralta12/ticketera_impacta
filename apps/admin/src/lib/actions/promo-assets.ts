"use server";

import { revalidatePath } from "next/cache";
import { DomainError, deletePromoAsset } from "@ticketera/db";
import type { FormState } from "@/lib/forms";
import { requireEditor } from "@/lib/session";

export async function deletePromoAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  try {
    await deletePromoAsset(staff.organization.id, String(formData.get("assetId") ?? ""), staff.id);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath("/eventos/[id]", "page");
  revalidatePath("/promotor");
  return { ok: true };
}
