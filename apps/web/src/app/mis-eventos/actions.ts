"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DomainError, transferTicket } from "@ticketera/db";
import { auth } from "@/lib/auth";

export type TransferState = { error?: string; done?: string } | undefined;

/** Pasa una entrada a otra cuenta registrada: ella la ve con un QR nuevo y la tuya deja de valer. */
export async function transferTicketAction(_prev: TransferState, formData: FormData): Promise<TransferState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/mis-eventos");
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Escribe el email de la cuenta que la recibe." };

  try {
    const { recipient } = await transferTicket({
      ticketId: String(formData.get("ticketId") ?? ""),
      fromCustomerId: session.user.id,
      toEmail: email,
    });
    revalidatePath("/mis-eventos");
    return { done: `Listo: la entrada ahora es de ${recipient.name}. Tu QR anterior ya no vale.` };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}
