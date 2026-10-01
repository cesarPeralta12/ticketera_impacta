"use server";

import { redirect } from "next/navigation";
import { DomainError, startPayment } from "@ticketera/db";
import { activeProvider, checkoutUrl } from "@/lib/payments";

export async function payOrderAction(formData: FormData) {
  const code = String(formData.get("code"));
  let url: string;
  try {
    url = checkoutUrl(await startPayment(code, activeProvider()));
  } catch (error) {
    // La orden venció o ya no es pagable: la página de la orden muestra el estado actual.
    if (error instanceof DomainError) redirect(`/orden/${code}`);
    throw error;
  }
  redirect(url);
}
