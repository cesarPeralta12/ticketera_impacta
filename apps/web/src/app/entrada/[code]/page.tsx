import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime } from "@ticketera/core";
import { listCustomerTickets } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { DynamicTicket } from "./dynamic-ticket";

export const metadata: Metadata = { title: "Mi entrada", robots: { index: false }, manifest: "/manifest.webmanifest" };

type Props = { params: Promise<{ code: string }> };

/**
 * Entrada de QR dinámico. La página solo describe la entrada: el QR lo calcula el celular (ver DynamicTicket),
 * así que sigue funcionando sin internet una vez abierta. El service worker guarda esta página para eso.
 */
export default async function TicketPage({ params }: Props) {
  await connection();
  const { code } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?next=${encodeURIComponent(`/entrada/${code}`)}`);

  const ticket = (await listCustomerTickets(session.user.id)).find((t) => t.code === code.toUpperCase());
  if (!ticket) notFound();
  if (ticket.qrMode !== "DYNAMIC") redirect("/mis-entradas"); // las de QR fijo se muestran en Mis entradas

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-10">
      <Link href="/mis-entradas" className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]">
        ← Mis entradas
      </Link>
      <DynamicTicket
        code={ticket.code}
        userId={session.user.id}
        eventTitle={ticket.eventTitle}
        when={formatDateTime(ticket.startsAt, ticket.timezone)}
        venue={ticket.venueName}
        typeName={ticket.typeName}
        seat={ticket.seat}
        holder={ticket.holderName}
        initialStatus={ticket.status === "USED" ? "USED" : "VALID"}
      />
    </main>
  );
}
