import Link from "next/link";
import { formatMoney, formatSerial, nextPrefix } from "@ticketera/core";
import { listPrintBatches, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { createPrintBatchAction, uploadTicketArtAction } from "@/lib/actions/printed";
import { PAPER_FORMATS, PAPER_LABEL } from "@/lib/print/tickets-pdf";
import { Help } from "@/components/help";

/**
 * Entradas impresas de una función (eventos chicos, venta en mano): sus lotes, crear uno nuevo, el diseño propio y
 * "imprimir todas las entradas" de la función.
 */
export async function PrintedCard({
  session,
  organizationId,
}: {
  session: {
    id: string;
    eventId: string;
    ticketTypes: { id: string; name: string; unitAmount: number; currency: string; kind: string; qrMode: string; section: { seatingMode: string } | null }[];
  };
  organizationId: string;
}) {
  const [batches, arts] = await Promise.all([
    listPrintBatches(session.id),
    prisma.ticketArt.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
  ]);
  // Se imprimen entradas generales de QR fijo (no butacas, mesas ni QR dinámico).
  const printable = session.ticketTypes.filter((t) => t.kind === "ENTRY" && t.qrMode === "STATIC" && t.section?.seatingMode !== "RESERVED");
  const staticTypes = session.ticketTypes.filter((t) => t.qrMode === "STATIC");
  const base = `/eventos/${session.eventId}/funciones/${session.id}/impresas`;

  return (
    <section className="card space-y-5 p-6" id="impresas">
      <div>
        <h2 className="eyebrow mb-1 flex items-center gap-2">
          Entradas impresas
          <Help title="Entradas impresas">
            Para vender en mano (vendedores, RRPP, puntos de venta). Un lote numerado (A-0001…) ocupa cupo al crearse y suma a
            la recaudación recién al marcarse vendido. Con «Activadas al vender», la puerta no las deja pasar hasta que las marcas
            vendidas (por rango o código). Entrégalas a vendedores y cierra la rendición con lo que te devolvieron.
          </Help>
        </h2>
      </div>

      {batches.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)] text-sm">
          {batches.map((b) => (
            <li key={b.id}>
              <Link href={`${base}/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-[var(--surface-2)]">
                <span>
                  <strong>Lote {b.prefix}</strong> · {formatSerial(b.prefix, b.firstNumber)} a {formatSerial(b.prefix, b.firstNumber + b.quantity - 1)} · {b.typeName}
                  {b.mode === "VALID_ON_PRINT" && <span className="badge ml-2 bg-[var(--warn-soft)] text-[var(--warn)]">válidas al imprimir</span>}
                </span>
                <span className="font-mono text-xs text-[var(--ink-muted)]">
                  {b.quantity} · {b.sold} vendidas · {b.assigned} entregadas · {b.used} entraron{b.voided ? ` · ${b.voided} anuladas` : ""} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {printable.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">
          Para imprimir hace falta un precio de entrada general (sin butaca ni mesa) de QR fijo.
        </p>
      ) : (
        <details open={batches.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-[var(--accent)]">Nuevo lote</summary>
          <ActionForm action={createPrintBatchAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="sessionId" value={session.id} />
            <label className="label">
              Tipo de entrada
              <select name="ticketTypeId" className="field">
                {printable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {formatMoney(t.unitAmount, t.currency)}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Cantidad
              <input name="quantity" type="number" min={1} max={2000} required placeholder="ej. 100" className="field w-28" />
            </label>
            <label className="label">
              Prefijo de la serie
              <input name="prefix" maxLength={4} placeholder={nextPrefix(batches.map((b) => b.prefix))} className="field w-24 uppercase" />
            </label>
            <label className="label">
              Precio de referencia (Bs)
              <input name="price" inputMode="decimal" placeholder="el del tipo" className="field w-32" />
            </label>
            <label className="label">
              Validez
              <select name="mode" defaultValue="ACTIVATE_ON_SALE" className="field">
                <option value="ACTIVATE_ON_SALE">Activadas al vender (recomendado)</option>
                <option value="VALID_ON_PRINT">Válidas al imprimir</option>
              </select>
            </label>
            <label className="label">
              Diseño de fondo
              <select name="artId" defaultValue="" className="field">
                <option value="">Sin diseño (blanco)</option>
                {arts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="label min-w-[12rem] flex-1">
              Nota (opcional)
              <input name="note" maxLength={200} placeholder="ej. talonarios para RRPP" className="field" />
            </label>
            <button type="submit" className="btn btn-dark">
              Crear lote
            </button>
            <p className="basis-full text-xs text-[var(--ink-dim)]">
              <strong>Activadas al vender</strong>: no abren la puerta hasta marcarse vendidas (una fotocopia o una robada no pasa).{" "}
              <strong>Válidas al imprimir</strong>: abren la puerta desde que se imprimen.
            </p>
          </ActionForm>
        </details>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-medium text-[var(--accent)]">Diseños de entrada ({arts.length})</summary>
        <ActionForm action={uploadTicketArtAction} resetOnSuccess className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="back" value={`/eventos/${session.eventId}/funciones/${session.id}`} />
          <label className="label">
            Nombre
            <input name="name" maxLength={60} placeholder="ej. Arte aniversario" className="field" />
          </label>
          <label className="label">
            Imagen (PNG o JPG, hasta 3 MB)
            <input name="art" type="file" accept="image/png,image/jpeg" required className="field" />
          </label>
          <button type="submit" className="btn">
            Subir diseño
          </button>
          <p className="basis-full text-xs text-[var(--ink-dim)]">
            Se dibuja de fondo en la entrada y encima van el QR, la serie y los datos (sobre un recuadro blanco para que se lean).
            Para la imprenta, prepara el arte a 200 × 80 mm más 2 mm de sangrado.
          </p>
        </ActionForm>
      </details>

      <form action="/imprimir" method="get" target="_blank" className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-4">
        <p className="basis-full text-sm font-medium">Imprimir todas las entradas de la función</p>
        <input type="hidden" name="funcion" value={session.id} />
        <label className="label">
          Cuáles
          <select name="alcance" defaultValue="todas" className="field">
            <option value="todas">Todas (vendidas, invitaciones, impresas e importadas)</option>
            <option value="online">Vendidas online</option>
            <option value="boleteria">Vendidas en boletería</option>
            <option value="invitaciones">Invitaciones</option>
            <option value="impresas">Impresas</option>
            <option value="importadas">Importadas desde Excel</option>
          </select>
        </label>
        <label className="label">
          Tipo
          <select name="tipo" defaultValue="" className="field">
            <option value="">Todos</option>
            {staticTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Orden
          <select name="orden" defaultValue="serie" className="field">
            <option value="serie">Por serie / emisión</option>
            <option value="nombre">Por nombre</option>
          </select>
        </label>
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
        <button type="submit" className="btn">
          Abrir PDF
        </button>
        <p className="basis-full text-xs text-[var(--ink-dim)]">Las de QR dinámico no se imprimen (el QR cambia cada 30 segundos).</p>
      </form>
    </section>
  );
}
