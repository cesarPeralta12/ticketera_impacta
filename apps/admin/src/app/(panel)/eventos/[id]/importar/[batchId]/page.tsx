import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime, formatMoney } from "@ticketera/core";
import { getImportContext, getImportSummary, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { confirmImportAction, discardImportAction, emailImportAction, undoImportAction } from "@/lib/actions/imports";
import { PAPER_FORMATS, PAPER_LABEL } from "@/lib/print/tickets-pdf";
import { IMPORT_STATUS, TICKET_STATUS } from "@/lib/labels";
import { ROLES, requireStaff, visibleEvent } from "@/lib/session";

export const metadata: Metadata = { title: "Importación" };

type Props = { params: Promise<{ id: string; batchId: string }> };

const SHOWN_ROWS = 300;

/** Vista previa de una importación (errores por fila, resumen por tipo) y, ya confirmada, sus entradas, PDF, correos y deshacer. */
export default async function ImportBatchPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id, batchId } = await params;
  const event = await visibleEvent(staff, id);
  if (!event) notFound();
  const summary = await getImportSummary(batchId);
  if (!summary || summary.batch.eventId !== event.id) notFound();
  const { batch } = summary;
  const sessions = await getImportContext(prisma, event.id);
  const sessionNumber = new Map(sessions.map((s, i) => [s.id, i + 1]));
  const timeZone = sessions[0]?.timeZone ?? "America/La_Paz";
  const currency = staff.organization.currency;
  const status = IMPORT_STATUS[batch.status];
  const editable = !staff.readOnly;

  // Resumen por función y tipo de entrada.
  const byType = new Map<string, { label: string; rows: number; tickets: number; amount: number }>();
  for (const row of batch.rows) {
    const key = `${row.sessionId}|${row.ticketTypeId}`;
    const line = byType.get(key) ?? { label: `${sessions.length > 1 ? `Función ${sessionNumber.get(row.sessionId)} · ` : ""}${row.typeName}`, rows: 0, tickets: 0, amount: 0 };
    line.rows++;
    line.tickets += row.people;
    line.amount += row.amount;
    byType.set(key, line);
  }
  const declared = batch.rows.reduce((sum, r) => sum + r.amount, 0);

  const orders =
    batch.status === "DRAFT" || batch.status === "DISCARDED"
      ? []
      : await prisma.order.findMany({
          where: { importBatchId: batch.id },
          orderBy: { createdAt: "asc" },
          take: SHOWN_ROWS,
          select: {
            code: true,
            buyerName: true,
            buyerDocument: true,
            buyerEmail: true,
            totalAmount: true,
            ticketsEmailedAt: true,
            items: { select: { name: true, seat: { select: { label: true } } } },
            tickets: { select: { status: true, credit: { select: { tableNumber: true } } } },
          },
        });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href={`/eventos/${event.id}/importar`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Importar entradas · {event.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{batch.fileName}</h1>
          <span className={`badge ${status.className}`}>{status.text}</span>
        </div>
        <p className="text-sm text-[var(--ink-muted)]">
          Subido por {batch.staff.name} el {formatDateTime(batch.createdAt, timeZone)}
          {batch.confirmedAt && ` · confirmado el ${formatDateTime(batch.confirmedAt, timeZone)}`}
          {batch.undoneAt && ` · deshecho el ${formatDateTime(batch.undoneAt, timeZone)}`}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Filas en el archivo" value={batch.totalRows} />
        <Stat label="Listas para importar" value={batch.validRows} tone="ok" />
        <Stat label="Con error" value={batch.errors.length} tone={batch.errors.length ? "bad" : undefined} />
        <Stat label="Entradas que emite" value={batch.ticketCount} />
      </dl>

      {batch.status === "DRAFT" && (
        <>
          {batch.errors.length > 0 && (
            <section className="card space-y-3 border-[var(--danger)]/40 p-6">
              <h2 className="eyebrow text-[var(--danger)]">Filas con error ({batch.errors.length})</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Corrígelas en el Excel y vuelve a subirlo, o confirma dejándolas fuera (se importan solo las filas listas).
              </p>
              <IssueTable issues={batch.errors} />
            </section>
          )}
          {batch.warnings.length > 0 && (
            <section className="card space-y-3 p-6">
              <h2 className="eyebrow text-[var(--warn)]">Avisos ({batch.warnings.length})</h2>
              <p className="text-sm text-[var(--ink-muted)]">No impiden importar; revísalos por si acaso.</p>
              <IssueTable issues={batch.warnings} />
            </section>
          )}

          {byType.size > 0 && (
            <section className="card space-y-3 p-6">
              <h2 className="eyebrow">Qué se va a importar</h2>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-[var(--ink-dim)]">
                  <tr>
                    <th className="py-1 font-normal">Tipo de entrada</th>
                    <th className="py-1 text-right font-normal">Filas</th>
                    <th className="py-1 text-right font-normal">Entradas</th>
                    <th className="py-1 text-right font-normal">Cobrado (declarado)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {[...byType.values()].map((line) => (
                    <tr key={line.label}>
                      <td className="py-2">{line.label}</td>
                      <td className="py-2 text-right font-mono">{line.rows}</td>
                      <td className="py-2 text-right font-mono">{line.tickets}</td>
                      <td className="py-2 text-right font-mono">{formatMoney(line.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <details>
                <summary className="cursor-pointer text-sm text-[var(--accent)]">
                  Ver las filas listas{batch.rows.length > SHOWN_ROWS ? ` (las primeras ${SHOWN_ROWS})` : ""}
                </summary>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="text-left text-xs text-[var(--ink-dim)]">
                      <tr>
                        <th className="py-1 font-normal">Fila</th>
                        <th className="py-1 font-normal">Nombre</th>
                        <th className="py-1 font-normal">Carnet</th>
                        <th className="py-1 font-normal">Correo</th>
                        <th className="py-1 font-normal">Tipo</th>
                        <th className="py-1 font-normal">Butaca o mesa</th>
                        <th className="py-1 text-right font-normal">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {batch.rows.slice(0, SHOWN_ROWS).map((r) => (
                        <tr key={r.line}>
                          <td className="py-1.5 font-mono text-xs text-[var(--ink-dim)]">{r.line}</td>
                          <td className="py-1.5">{r.name}</td>
                          <td className="py-1.5">{r.document ?? "—"}</td>
                          <td className="py-1.5">{r.email ?? "—"}</td>
                          <td className="py-1.5">{r.typeName}</td>
                          <td className="py-1.5">{r.place ?? "—"}</td>
                          <td className="py-1.5 text-right font-mono">{formatMoney(r.amount, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          )}

          {editable && (
            <section className="card flex flex-wrap items-start justify-between gap-4 p-6">
              {batch.errors.length > 0 ? (
                // Con errores no se emite nada (ni las filas buenas): se corrige el Excel y se sube de nuevo.
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-[var(--danger)]">
                    Hay {batch.errors.length} fila(s) con error. No se emite ninguna entrada hasta que el archivo esté
                    sin errores: corrígelas en el Excel y vuelve a subirlo.
                  </p>
                  <Link href={`/eventos/${event.id}/importar`} className="btn btn-primary w-fit">
                    Subir el archivo corregido
                  </Link>
                </div>
              ) : (
                <ActionForm action={confirmImportAction} className="flex flex-col gap-3">
                  <input type="hidden" name="batchId" value={batch.id} />
                  <button type="submit" disabled={batch.validRows === 0} className="btn btn-primary w-fit disabled:cursor-not-allowed disabled:opacity-50">
                    Confirmar e importar {batch.ticketCount} entrada(s)
                  </button>
                  <p className="text-xs text-[var(--ink-dim)]">
                    Se emiten todas juntas o ninguna. Ocupan cupo y suman {formatMoney(declared, currency)} al reporte (lo
                    declarado como cobrado).
                  </p>
                </ActionForm>
              )}
              <ActionForm action={discardImportAction}>
                <input type="hidden" name="batchId" value={batch.id} />
                <button type="submit" className="btn">
                  Descartar
                </button>
              </ActionForm>
            </section>
          )}
        </>
      )}

      {(batch.status === "CONFIRMED" || batch.status === "UNDONE") && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Válidas" value={summary.tickets.valid} tone="ok" />
            <Stat label="Ya entraron" value={summary.tickets.used} />
            <Stat label="Anuladas" value={summary.tickets.cancelled} tone={summary.tickets.cancelled ? "bad" : undefined} />
            <Stat label="Cobrado (declarado)" value={formatMoney(summary.revenue, currency)} />
          </dl>

          {batch.status === "CONFIRMED" && editable && (
            <section className="card grid gap-6 p-6 md:grid-cols-2">
              <div className="space-y-3">
                <h2 className="eyebrow">Entregar las entradas</h2>
                <form action="/imprimir" method="get" target="_blank" className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="importacion" value={batch.id} />
                  <label className="label">
                    Formato
                    <select name="formato" defaultValue="carta3" className="field">
                      {PAPER_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {PAPER_LABEL[f]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Orden
                    <select name="orden" defaultValue="nombre" className="field">
                      <option value="nombre">Por nombre</option>
                      <option value="serie">Como en el archivo</option>
                    </select>
                  </label>
                  <button type="submit" className="btn">
                    PDF de todas
                  </button>
                </form>
                <ActionForm action={emailImportAction} className="space-y-2">
                  <input type="hidden" name="batchId" value={batch.id} />
                  <button type="submit" disabled={summary.email.pending === 0} className="btn btn-dark disabled:cursor-not-allowed disabled:opacity-50">
                    {summary.email.pending > 0 ? `Enviar por correo (${summary.email.pending} pendiente(s))` : "Correos enviados"}
                  </button>
                  <p className="text-xs text-[var(--ink-dim)]">
                    {summary.email.sent} enviado(s) · {summary.email.without} sin correo (a esas, imprímelas). Se envían de a 50 por clic.
                  </p>
                </ActionForm>
              </div>
              <ActionForm action={undoImportAction} className="space-y-3">
                <h2 className="eyebrow text-[var(--danger)]">Deshacer la importación</h2>
                <input type="hidden" name="batchId" value={batch.id} />
                <p className="text-sm text-[var(--ink-muted)]">
                  Anula las entradas que no se usaron y libera su cupo. Las que ya entraron quedan como usadas.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="confirm" />
                  Entiendo que se anulan {summary.tickets.valid} entrada(s)
                </label>
                <button type="submit" className="btn border-[var(--danger)] text-[var(--danger)]">
                  Deshacer
                </button>
              </ActionForm>
            </section>
          )}

          <section className="card p-6">
            <h2 className="eyebrow mb-3">
              Entradas importadas{orders.length === SHOWN_ROWS ? ` (las primeras ${SHOWN_ROWS})` : ""}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-[var(--ink-dim)]">
                  <tr>
                    <th className="py-1 font-normal">Nombre</th>
                    <th className="py-1 font-normal">Carnet</th>
                    <th className="py-1 font-normal">Tipo</th>
                    <th className="py-1 font-normal">Butaca o mesa</th>
                    <th className="py-1 font-normal">Estado</th>
                    <th className="py-1 font-normal">Correo</th>
                    <th className="py-1 font-normal">Orden</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {orders.map((o) => {
                    const ticket = o.tickets[0];
                    const state = ticket ? TICKET_STATUS[o.tickets.some((t) => t.status === "USED") ? "USED" : ticket.status] : null;
                    const table = ticket?.credit?.tableNumber;
                    return (
                      <tr key={o.code}>
                        <td className="py-1.5">{o.buyerName}</td>
                        <td className="py-1.5">{o.buyerDocument ?? "—"}</td>
                        <td className="py-1.5">
                          {o.items[0]?.name}
                          {o.tickets.length > 1 && <span className="text-xs text-[var(--ink-dim)]"> · {o.tickets.length} personas</span>}
                        </td>
                        <td className="py-1.5">{o.items[0]?.seat?.label ?? (table ? `Mesa ${table}` : "—")}</td>
                        <td className="py-1.5">{state && <span className={`badge ${state.className}`}>{state.text}</span>}</td>
                        <td className="py-1.5 text-xs">{o.buyerEmail ? (o.ticketsEmailedAt ? "Enviado" : "Pendiente") : "Sin correo"}</td>
                        <td className="py-1.5 font-mono text-xs">{o.code}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {batch.status === "DISCARDED" && <p className="card p-6 text-sm text-[var(--ink-muted)]">Esta importación se descartó sin confirmar: no emitió entradas.</p>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "bad" }) {
  const color = tone === "ok" ? "text-[var(--success)]" : tone === "bad" ? "text-[var(--danger)]" : "";
  return (
    <div className="card p-4">
      <dt className="text-xs text-[var(--ink-dim)]">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold ${color}`}>{value}</dd>
    </div>
  );
}

function IssueTable({ issues }: { issues: { line: number; message: string }[] }) {
  return (
    <ul className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto rounded-md border border-[var(--border)] text-sm">
      {issues.slice(0, 500).map((issue, i) => (
        <li key={`${issue.line}-${i}`} className="flex gap-3 px-3 py-2">
          <span className="w-14 shrink-0 font-mono text-xs text-[var(--ink-dim)]">Fila {issue.line}</span>
          <span>{issue.message}</span>
        </li>
      ))}
      {issues.length > 500 && <li className="px-3 py-2 text-xs text-[var(--ink-dim)]">…y {issues.length - 500} más.</li>}
    </ul>
  );
}
