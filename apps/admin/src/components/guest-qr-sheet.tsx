import Link from "next/link";
import { formatCode, formatDateTime } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { PrintButton } from "@/components/print-button";
import { ticketQrSvg } from "@/lib/qr";

/**
 * Hoja imprimible con el QR de cada invitación válida (para entregar en mano o en sobre).
 * Quien llama ya verificó el acceso al evento; null si la función no es de ese evento.
 */
export async function GuestQrSheet({ eventId, sessionId, backHref }: { eventId: string; sessionId: string; backHref: string }) {
  const session = await prisma.eventSession.findFirst({
    where: { id: sessionId, eventId },
    include: { event: true, venue: true },
  });
  if (!session) return null;

  const tickets = await prisma.ticket.findMany({
    where: { sessionId: session.id, order: { channel: "GUEST" }, status: "VALID" },
    orderBy: { holderName: "asc" },
    include: { ticketType: { select: { name: true } } },
  });
  const cards = await Promise.all(tickets.map(async (t) => ({ ...t, qr: await ticketQrSvg(t.code) })));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link
            href={backHref}
            className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]"
          >
            ← Invitados
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">QRs de invitados</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {cards.length} invitación(es) válidas. Las que ya ingresaron o están anuladas no se imprimen.
          </p>
        </div>
        <PrintButton />
      </div>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        {cards.map((t) => (
          <li
            key={t.id}
            className="break-inside-avoid rounded-lg border border-[var(--border)] bg-white p-4 text-center print:rounded-none print:border-dashed"
          >
            <p className="eyebrow">{session.event.title}</p>
            <p className="text-xs text-[var(--ink-muted)]">
              {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name}
            </p>
            <div className="mx-auto my-2 w-36" dangerouslySetInnerHTML={{ __html: t.qr }} />
            <p className="font-semibold">{t.holderName}</p>
            <p className="text-xs text-[var(--ink-muted)]">{t.ticketType.name}</p>
            <p className="font-mono text-xs tracking-wider">{formatCode(t.code)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
