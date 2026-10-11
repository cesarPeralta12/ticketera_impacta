"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DomainError, acceptTransfer, cancelTransfer, createTransfer, declineTransfer } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { sendTransferAcceptedEmails, sendTransferOfferedEmail } from "@/lib/mail";

export type OfferState = { error?: string; message?: string } | undefined;

async function customerId() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/mis-entradas");
  return session.user.id;
}

/** Ofrece una entrada a otra persona registrada, por email o por carnet. */
export async function offerTicketAction(_prev: OfferState, formData: FormData): Promise<OfferState> {
  const fromCustomerId = await customerId();
  const recipient = String(formData.get("recipient") ?? "").trim();
  if (!recipient) return { error: "Escribe el email o el carnet de la persona." };
  try {
    const offer = await createTransfer({
      ticketId: String(formData.get("ticketId") ?? ""),
      fromCustomerId,
      to: recipient.includes("@") ? { email: recipient } : { document: recipient },
    });
    await sendTransferOfferedEmail(offer);
    revalidatePath("/mis-entradas");
    return { message: `Le enviamos la oferta a ${offer.to.name}. La entrada sigue siendo tuya hasta que la acepte.` };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

/** Acepta una entrada que le ofrecieron: pasa a su cuenta con un QR nuevo, que también le llega por correo. */
export async function acceptTransferAction(formData: FormData) {
  const id = await customerId();
  try {
    const done = await acceptTransfer(String(formData.get("transferId") ?? ""), id);
    await sendTransferAcceptedEmails(done);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    redirect(`/mis-entradas?aviso=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/mis-entradas");
  redirect("/mis-entradas?aviso=" + encodeURIComponent("¡Listo! La entrada ya está en tu cuenta."));
}

export async function declineTransferAction(formData: FormData) {
  const id = await customerId();
  try {
    await declineTransfer(String(formData.get("transferId") ?? ""), id);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
  revalidatePath("/mis-entradas");
}

export async function cancelTransferAction(formData: FormData) {
  const id = await customerId();
  try {
    await cancelTransfer(String(formData.get("transferId") ?? ""), id);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
  revalidatePath("/mis-entradas");
}
