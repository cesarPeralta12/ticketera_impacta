import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatCode, formatDateTime } from "@ticketera/core";
import { DomainError, canManageWristbands, getWristbandBatch } from "@ticketera/db";
import { formatUid } from "@/lib/format-uid";
import { ROLES, requireStaff } from "@/lib/session";
import { BatchReader } from "./batch-reader";

export const metadata: Metadata = { title: "Lote de manillas" };

type Props = { params: Promise<{ sessionId: string; batchId: string }> };

export default async function WristbandBatchPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.pos);
  const { sessionId, batchId } = await params;
  const account = { id: staff.id, role: staff.role, organizationId: staff.organization.id };
  const data = await getWristbandBatch(account, batchId).catch((error: unknown) => {
    if (error instanceof DomainError) return null;
    throw error;
  });
  if (!data || data.batch.sessionId !== sessionId || data.batch.status === "DISCARDED") notFound();
  const { batch, rows, available } = data;
  const manage = !staff.readOnly && canManageWristbands(account);
  const back = `/boleteria/lotes/${sessionId}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href={back} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Lotes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{batch.name}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {batch.ticketType.name} · {batch.session.event.title} · {formatDateTime(batch.session.startsAt, batch.session.venue.timezone)} ·{" "}
          {batch.mode === "VALID_ON_PRINT" ? "abren la puerta al confirmar" : "se activan al venderse"}
        </p>
      </div>

      {batch.status === "OPEN" ? (
        staff.readOnly ? (
          <p className="card p-5 text-sm text-[var(--ink-muted)]">Cuenta de solo lectura: las manillas las carga el personal.</p>
        ) : (
          <BatchReader
            batchId={batch.id}
            backHref={back}
            initial={rows.map((r) => ({ id: r.id, uid: r.uid }))}
            expected={batch.expected}
            available={available}
            manage={manage}
          />
        )
      ) : (
        <section className="card space-y-4 p-5 sm:p-6">
          <p role="status" className="rounded-md bg-[var(--success-soft)] px-4 py-3 text-sm font-medium text-[var(--success)]">
            Lote confirmado{batch.confirmedAt ? ` el ${formatDateTime(batch.confirmedAt, batch.session.venue.timezone)}` : ""}: {rows.length}{" "}
            manillas. La puerta las reconoce al actualizar su lista.
          </p>
          {manage && batch.printBatchId && (
            <p className="text-sm text-[var(--ink-muted)]">
              Para venderlas, entregarlas a un vendedor o anular una perdida, usa{" "}
              <Link href={`/eventos/${batch.session.eventId}/funciones/${sessionId}/impresas`} className="text-[var(--accent)] hover:underline">
                Entradas impresas
              </Link>{" "}
              (el lote figura con el prefijo {batch.printBatch?.prefix}).
            </p>
          )}
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="eyebrow border-b border-[var(--border)]">
                <tr>
                  <th className="py-2 pr-4 font-normal">Serie</th>
                  <th className="py-2 pr-4 font-normal">Número del chip</th>
                  <th className="py-2 font-normal">Código</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] font-mono text-xs">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-4 font-semibold">{r.serial ?? "—"}</td>
                    <td className="py-1.5 pr-4">{formatUid(r.uid)}</td>
                    <td className="py-1.5">{r.code ? formatCode(r.code) : "cambiada o quitada"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
