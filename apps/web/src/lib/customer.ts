import { redirect } from "next/navigation";
import { prisma } from "@ticketera/db";
import { auth } from "./auth";

/**
 * Comprador que está comprando: comprar exige cuenta con carnet. Sin sesión va al login y, si la
 * cuenta no tiene carnet (cuentas antiguas), a completarlo; en los dos casos vuelve a `next`.
 */
export async function requireBuyer(next: string) {
  const session = await auth();
  const customer = session?.user?.id
    ? await prisma.customer.findUnique({
        where: { id: session.user.id },
        select: { id: true, name: true, email: true, documentId: true, phone: true },
      })
    : null;
  if (!customer) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!customer.documentId) redirect(`/cuenta/datos?next=${encodeURIComponent(next)}`);
  return { ...customer, documentId: customer.documentId };
}
