import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { formatCode, formatDateTime, formatMoney } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { auth } from "@/lib/auth";

export const metadata: Metadata = { title: "Mis eventos", robots: { index: false } };

const statusText: Record<string, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Confirmada",
  EXPIRED: "Reserva vencida",
  CANCELLED: "Cancelada",
  REFUNDED: "Reembolsada",
  PARTIALLY_REFUNDED: "Reembolso parcial",
};

export default async function MyEventsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/mis-eventos");

  // Solo órdenes hechas con la cuenta iniciada: nunca se buscan por email, que nadie verificó.
  const orders = await prisma.order.findMany({
    where: { customerId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      items: { take: 1, include: { ticketType: { include: { session: { include: { event: true, venue: true } } } } } },
      _count: { select: { tickets: true } },
    },
  });

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-12">
      <div>
        <p className="eyebrow">{session.user.name}</p>
        <h1 className="font-display text-4xl">Mis eventos</h1>
        <Link href="/mis-entradas" className="mt-2 inline-block text-sm text-[var(--accent)] underline underline-offset-4">
          Ver mis entradas y transferirlas a otra persona →
        </Link>
      </div>

      {orders.length === 0 ? (
        <p className="text-[var(--ink-muted)]">
          Todavía no compraste con esta cuenta.{" "}
          <Link href="/" className="text-[var(--accent)] underline underline-offset-4">
            Ver eventos
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => {
            const s = order.items[0]?.ticketType.session;
            return (
              <li key={order.id}>
                <Link
                  href={`/orden/${order.code}`}
                  className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-[var(--accent)]"
                >
                  <div>
                    <p className="font-display text-lg">{s?.event.title}</p>
                    {s && (
                      <p className="text-sm capitalize text-[var(--ink-muted)]">
                        {formatDateTime(s.startsAt, s.venue.timezone)} · {s.venue.name}
                      </p>
                    )}
                    <p className="font-mono text-xs text-[var(--ink-dim)]">Orden {formatCode(order.code)}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className={order.status === "PAID" ? "font-semibold text-[var(--green)]" : "text-[var(--ink-muted)]"}>
                      {statusText[order.status]}
                    </p>
                    <p className="text-[var(--ink-dim)]">
                      {order._count.tickets > 0 ? `${order._count.tickets} entrada(s) · ` : ""}
                      {formatMoney(order.totalAmount, order.currency)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
