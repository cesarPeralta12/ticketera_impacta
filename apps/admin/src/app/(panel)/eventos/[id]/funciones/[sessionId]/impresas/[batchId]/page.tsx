import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PRINT_STATE_LABEL, formatDateTime, formatMoney, formatSerial, type PrintStateName } from "@ticketera/core";
import { getPrintBatchReport, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { movePrintedAction, setPrintBatchArtAction, settleSellerAction } from "@/lib/actions/printed";
import { PAPER_FORMATS, PAPER_LABEL } from "@/lib/print/tickets-pdf";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Lote de entradas impresas" };

type Props = { params: Promise<{ id: string; sessionId: string; batchId: string }> };

const STATE_CLASS: Record<PrintStateName, string> = {
  STOCK: "bg-[var(--surface-2)] text-[var(--ink-muted)]",
  ASSIGNED: "bg-[var(--info-soft)] text-[var(--info)]",
  SOLD: "bg-[var(--success-soft)] text-[var(--success)]",
  RETURNED: "bg-[var(--warn-soft)] text-[var(--warn)]",
  VOID: "bg-[var(--danger-soft)] text-[var(--danger)]",
};

/** Un lote de entradas impresas: imprimir, entregar a vendedores, vender, devolver, anular y rendir. */
export default async function PrintBatchPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id, sessionId, batchId } = await params;
  const report = await getPrintBatchReport(batchId);
  if (!report || report.batch.sessionId !== sessionId || report.batch.session.eventId !== id || report.batch.session.event.organizationId !== staff.organization.id) {
    notFound();
  }
  const { batch, counts, used, revenue, sellers } = report;
  const arts = await prisma.ticketArt.findMany({ where: { organizationId: staff.organization.id }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } });
  const tz = batch.session.venue.timezone;
  const money = (v: number) => formatMoney(v, batch.currency);
  const first = formatSerial(batch.prefix, batch.firstNumber);
  const last = formatSerial(batch.prefix, batch.firstNumber + batch.quantity - 1);
  const rangeHint = `ej. ${batch.firstNumber}-${Math.min(batch.firstNumber + 19, batch.firstNumber + batch.quantity - 1)}`;
  const activate = batch.mode === "ACTIVATE_ON_SALE";
  const stats: [string, number | string][] = [
    ["Impresas", batch.quantity],
    ["En stock", counts.STOCK],
    ["Entregadas", counts.ASSIGNED],
    ["Vendidas", counts.SOLD],
    ["Devueltas", counts.RETURNED],
    ["Anuladas", counts.VOID],
    ["Ya entraron", used],
    ["Recaudado", money(revenue)],
  ];

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/eventos/${id}/funciones/${sessionId}?tab=impresas`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← {batch.session.event.title} · {formatDateTime(batch.session.startsAt, tz)}
        </Link>
        <p className="eyebrow mt-2">Entradas impresas</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Lote {batch.prefix} · {batch.ticketType.name}
        </h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {first} a {last} · precio de referencia {money(batch.unitAmount)} · creado por {batch.createdBy.name} el {formatDateTime(batch.createdAt, tz)}
          {batch.art && ` · diseño "${batch.art.name}"`}
        </p>
        <p className={`mt-2 w-fit rounded-md px-3 py-1.5 text-sm ${activate ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--warn-soft)] text-[var(--warn)]"}`}>
          {activate
            ? "Activadas al vender: una entrada abre la puerta recién cuando se marca vendida. Una fotocopia o una sin vender no pasa."
            : "Válidas desde que se imprimen: cualquiera de estas entradas abre la puerta (una fotocopia también)."}
        </p>
        {batch.note && <p className="mt-1 text-sm text-[var(--ink-muted)]">Nota: {batch.note}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="card p-4">
            <dt className="eyebrow">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="card space-y-4 p-6">
        <h2 className="eyebrow">Imprimir</h2>
        {/* El diseño se puede poner o cambiar en cualquier momento: solo cambia cómo sale el PDF. */}
        <ActionForm action={setPrintBatchArtAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="batchId" value={batch.id} />
          <label className="label">
            Diseño de fondo
            <select name="artId" defaultValue={batch.art?.id ?? ""} className="field min-w-56">
              <option value="">Sin diseño (blanco)</option>
              {arts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn">
            Guardar diseño
          </button>
          {arts.length === 0 && (
            <p className="basis-full text-xs text-[var(--ink-dim)]">Todavía no subiste diseños: se suben en la función, pestaña Impresas, &ldquo;Diseños de entrada&rdquo;.</p>
          )}
        </ActionForm>
        <form action="/imprimir" method="get" target="_blank" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="lote" value={batch.id} />
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
            Desde (opcional)
            <input name="desde" type="number" min={batch.firstNumber} placeholder={String(batch.firstNumber)} className="field w-28" />
          </label>
          <label className="label">
            Hasta
            <input name="hasta" type="number" min={batch.firstNumber} placeholder={String(batch.firstNumber + batch.quantity - 1)} className="field w-28" />
          </label>
          {batch.art && (
            <label className="flex items-center gap-2 self-center text-sm">
              <input type="checkbox" name="arte" value="0" className="h-4 w-4" /> Sin el diseño de fondo
            </label>
          )}
          <button type="submit" className="btn btn-dark">
            Abrir PDF
          </button>
          <a href={`/imprimir?lote=${batch.id}&csv=1`} className="btn">
            Códigos para la imprenta (CSV)
          </a>
        </form>
        <p className="text-xs text-[var(--ink-dim)]">
          Imprime primero una hoja de prueba en la impresora real y léela con la app de puerta. Cada impresión queda registrada;
          las reimpresiones aparecen en Seguridad.
        </p>
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="eyebrow">Mover entradas</h2>
        <p className="text-sm text-[var(--ink-muted)]">
          Elige un rango de serie ({rangeHint}) o pega/escanea los códigos, uno por línea (el lector USB escribe el código y
          salta de línea solo).
        </p>

        <details open className="rounded-md border border-[var(--border)] p-4">
          <summary className="cursor-pointer text-sm font-medium">Vender</summary>
          <ActionForm action={movePrintedAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="action" value="SELL" />
            <label className="label">
              Rango
              <input name="range" placeholder={rangeHint} className="field w-36" />
            </label>
            <label className="label min-w-[14rem] flex-1">
              O códigos escaneados
              <textarea name="codes" rows={2} placeholder="K7Q3M-XPA2B" className="field font-mono" />
            </label>
            <label className="label">
              Cobro
              <select name="method" defaultValue="EFECTIVO" className="field">
                <option value="EFECTIVO">Efectivo</option>
                <option value="QR">QR</option>
                <option value="TRANSFERENCIA">Transferencia</option>
              </select>
            </label>
            <label className="label">
              Precio (Bs)
              <input name="price" inputMode="decimal" placeholder={(batch.unitAmount / 100).toString()} className="field w-24" />
            </label>
            <button type="submit" className="btn btn-dark">
              Marcar vendidas
            </button>
          </ActionForm>
        </details>

        <details className="rounded-md border border-[var(--border)] p-4">
          <summary className="cursor-pointer text-sm font-medium">Entregar a un vendedor o RRPP</summary>
          <ActionForm action={movePrintedAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="action" value="ASSIGN" />
            <label className="label">
              Rango
              <input name="range" required placeholder={rangeHint} className="field w-36" />
            </label>
            <label className="label">
              Vendedor
              <input name="seller" required list="vendedores" placeholder="Nombre" className="field" />
              <datalist id="vendedores">
                {sellers.map((s) => (
                  <option key={s.seller} value={s.seller} />
                ))}
              </datalist>
            </label>
            <button type="submit" className="btn btn-dark">
              Entregar
            </button>
          </ActionForm>
        </details>

        {(
          [
            ["RETURN", "Devolver (volvieron sin vender)", "Marcar devueltas", undefined],
            ["STOCK", "Volver a stock (quitar el vendedor)", "Volver a stock", undefined],
            ["VOID", "Anular (perdidas o inválidas: no abren la puerta y liberan su lugar)", "Anular", "¿Anular esas entradas? No abren la puerta y no se pueden recuperar."],
          ] as const
        ).map(([action, title, button, confirm]) => (
          <details key={action} className="rounded-md border border-[var(--border)] p-4">
            <summary className="cursor-pointer text-sm font-medium">{title}</summary>
            <ActionForm action={movePrintedAction} confirm={confirm} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="batchId" value={batch.id} />
              <input type="hidden" name="action" value={action} />
              <label className="label">
                Rango
                <input name="range" placeholder={rangeHint} className="field w-36" />
              </label>
              <label className="label min-w-[14rem] flex-1">
                O códigos
                <textarea name="codes" rows={2} className="field font-mono" />
              </label>
              <button type="submit" className={`btn ${action === "VOID" ? "text-[var(--danger)]" : ""}`}>
                {button}
              </button>
            </ActionForm>
          </details>
        ))}
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="eyebrow">Vendedores y rendición</h2>
        {sellers.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">Todavía no se entregaron entradas de este lote a ningún vendedor.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="eyebrow border-b border-[var(--border)]">
                <tr>
                  <th className="py-2 pr-4 font-normal">Vendedor</th>
                  <th className="py-2 pr-4 text-right font-normal">Entregadas</th>
                  <th className="py-2 pr-4 text-right font-normal">En mano</th>
                  <th className="py-2 pr-4 text-right font-normal">Vendidas</th>
                  <th className="py-2 pr-4 text-right font-normal">Devueltas</th>
                  <th className="py-2 pr-4 text-right font-normal">Vendido</th>
                  <th className="py-2 pr-4 text-right font-normal">Rendido</th>
                  <th className="py-2 text-right font-normal">Falta rendir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {sellers.map((s) => (
                  <tr key={s.seller}>
                    <td className="py-2 pr-4 font-medium">{s.seller}</td>
                    <td className="py-2 pr-4 text-right font-mono">{s.assigned}</td>
                    <td className="py-2 pr-4 text-right font-mono">{s.inHand}</td>
                    <td className="py-2 pr-4 text-right font-mono">{s.sold}</td>
                    <td className="py-2 pr-4 text-right font-mono">{s.returned}</td>
                    <td className="py-2 pr-4 text-right font-mono">{money(s.soldAmount)}</td>
                    <td className="py-2 pr-4 text-right font-mono">{money(s.received)}</td>
                    <td className={`py-2 text-right font-mono ${s.pending > 0 ? "text-[var(--warn)]" : s.pending < 0 ? "text-[var(--success)]" : ""}`}>{money(s.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sellers.length > 0 && (
          <ActionForm action={settleSellerAction} className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-4">
            <input type="hidden" name="batchId" value={batch.id} />
            <label className="label">
              Rinde
              <select name="seller" className="field">
                {sellers.map((s) => (
                  <option key={s.seller} value={s.seller}>
                    {s.seller} (debe {money(s.pending)})
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Entregó (Bs)
              <input name="received" required inputMode="decimal" placeholder="ej. 600" className="field w-28" />
            </label>
            <label className="label min-w-[12rem] flex-1">
              Nota (opcional)
              <input name="note" maxLength={200} className="field" />
            </label>
            <button type="submit" className="btn btn-dark">
              Registrar rendición
            </button>
            <p className="basis-full text-xs text-[var(--ink-dim)]">
              Antes de rendir, marca como vendidas y devueltas las de ese vendedor: el sistema calcula cuánto debe entregar.
            </p>
          </ActionForm>
        )}
        {batch.settlements.length > 0 && (
          <ul className="space-y-1 text-sm">
            {batch.settlements.map((s) => (
              <li key={s.id} className="text-[var(--ink-muted)]">
                {formatDateTime(s.createdAt, tz)} · <strong className="text-[var(--ink)]">{s.seller}</strong> entregó {money(s.receivedAmount)} de {money(s.expectedAmount)}
                {s.receivedAmount !== s.expectedAmount && (
                  <span className={s.receivedAmount < s.expectedAmount ? "text-[var(--danger)]" : "text-[var(--success)]"}>
                    {" "}
                    ({s.receivedAmount < s.expectedAmount ? "faltan" : "sobran"} {money(Math.abs(s.receivedAmount - s.expectedAmount))})
                  </span>
                )}{" "}
                · recibió {s.staff.name}
                {s.note && ` · ${s.note}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-6">
        <h2 className="eyebrow mb-4">Entradas del lote</h2>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="eyebrow sticky top-0 border-b border-[var(--border)] bg-[var(--surface)]">
              <tr>
                <th className="py-2 pr-4 font-normal">Serie</th>
                <th className="py-2 pr-4 font-normal">Código</th>
                <th className="py-2 pr-4 font-normal">Estado</th>
                <th className="py-2 pr-4 font-normal">Vendedor</th>
                <th className="py-2 pr-4 font-normal">Venta</th>
                <th className="py-2 pr-4 font-normal">Ingreso</th>
                <th className="py-2 text-right font-normal">Impresa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {batch.tickets.map((t) => {
                const state = (t.printState ?? "STOCK") as PrintStateName;
                return (
                  <tr key={t.id}>
                    <td className="py-1.5 pr-4 font-mono font-semibold">{t.serial}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs text-[var(--ink-muted)]">{t.code.replace(/(.{5})(.{5})/, "$1-$2")}</td>
                    <td className="py-1.5 pr-4">
                      <span className={`badge ${STATE_CLASS[state]}`}>{PRINT_STATE_LABEL[state]}</span>
                    </td>
                    <td className="py-1.5 pr-4">{t.assignedTo ?? "—"}</td>
                    <td className="py-1.5 pr-4 text-xs">{t.soldAt ? `${formatDateTime(t.soldAt, tz)} · ${t.soldMethod?.toLowerCase()} · ${money(t.order.totalAmount)}` : "—"}</td>
                    <td className="py-1.5 pr-4 text-xs">{t.status === "USED" && t.usedAt ? formatDateTime(t.usedAt, tz) : "—"}</td>
                    <td className={`py-1.5 text-right font-mono text-xs ${t.printedCount > 1 ? "text-[var(--warn)]" : ""}`}>{t.printedCount}×</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
