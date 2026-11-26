import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { MAX_IMPORT_ROWS, formatDateTime, peopleIn, type ImportMapping } from "@ticketera/core";
import { getImportContext, listImportBatches, listImportFormats, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { uploadImportAction } from "@/lib/actions/imports";
import { IMPORT_STATUS } from "@/lib/labels";
import { ROLES, requireStaff, visibleEvent } from "@/lib/session";
import { Help } from "@/components/help";
import { ExternalImport, type TypeChoice } from "./external-import";

export const metadata: Metadata = { title: "Importar entradas" };

type Props = { params: Promise<{ id: string }> };

/** Importar entradas desde Excel en 3 pasos: plantilla, subir y revisar, confirmar (en la vista previa). */
export default async function ImportPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const event = await visibleEvent(staff, (await params).id);
  if (!event) notFound();
  const [sessions, batches, formats] = await Promise.all([getImportContext(prisma, event.id), listImportBatches(event.id), listImportFormats(event.organizationId)]);
  const active = sessions.filter((s) => !s.cancelled);
  // Secciones generales (sin butaca) del lugar de cada función: el tipo nuevo del asistente va en una de ellas.
  const generalSections = [
    ...new Set(
      (await prisma.section.findMany({ where: { seatingMode: "GENERAL_ADMISSION", archivedAt: null, venue: { sessions: { some: { eventId: event.id, cancelledAt: null } } } }, select: { name: true }, orderBy: { name: "asc" } })).map((s) => s.name),
    ),
  ];
  // Para emparejar las entradas de otro proveedor: cada tipo (por nombre) con lo que define en la puerta.
  const methodText = { QR: "QR", BARCODE: "código de barras", NFC: "NFC" } as const;
  const typeChoices: TypeChoice[] = [
    ...new Map(
      active.flatMap((s) =>
        s.ticketTypes
          .filter((t) => t.qrMode !== "DYNAMIC")
          .map((t) => [
            t.name,
            {
              name: t.name,
              detail: `${t.section?.name ?? "Sin sección"} · se lee con ${t.accessMethods.map((m) => methodText[m]).join(" o ")}${peopleIn(t) > 1 ? ` · mesa de ${peopleIn(t)} (no se carga con código)` : ""}`,
            },
          ] as const),
      ),
    ).values(),
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/eventos/${event.id}`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← {event.title}
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          Importar entradas desde Excel
          <Help title="Importar desde Excel">
            Descarga la plantilla, llénala (una fila por persona; en una mesa, una fila por mesa) y súbela. Antes de tocar el
            cupo ves cada fila con su error; confirmas todo junto y, si te equivocaste, deshaces la importación entera.
          </Help>
        </h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Para lo vendido por otro medio o para invitar sin pasar por la web. Cada fila recibe su entrada con QR, ocupa
          cupo igual que una venta y se ve en el reporte como «Importadas». Puedes deshacer una importación entera.
        </p>
      </div>

      {active.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--ink-muted)]">Primero agrega una función con sus tipos de entrada.</p>
      ) : (
        <>
          <section className="card space-y-3 p-6">
            <h2 className="eyebrow">1. Descarga la plantilla</h2>
            <p className="text-sm text-[var(--ink-muted)]">
              Trae las funciones y los tipos de entrada de este evento en listas desplegables. Una fila por persona (en
              una mesa, una fila por mesa). Hasta {MAX_IMPORT_ROWS.toLocaleString("es-BO")} filas por archivo.
            </p>
            <a href={`/eventos/${event.id}/importar/plantilla`} className="btn btn-dark inline-flex" download>
              Descargar plantilla (.xlsx)
            </a>
            <details className="text-sm">
              <summary className="cursor-pointer text-[var(--accent)]">Qué tipos se pueden importar</summary>
              <ul className="mt-2 space-y-1">
                {active.flatMap((s) =>
                  s.ticketTypes.map((t) => (
                    <li key={t.id} className="flex flex-wrap justify-between gap-2 border-b border-[var(--border)] py-1">
                      <span>
                        <strong>{t.name}</strong> · {formatDateTime(s.startsAt, s.timeZone)}
                      </span>
                      <span className="text-[var(--ink-muted)]">
                        {t.qrMode === "DYNAMIC"
                          ? "No se importa (QR dinámico)"
                          : t.section?.seatingMode === "RESERVED"
                            ? `${t.kind === "TABLE" ? "Mesa del mapa" : "Butaca"} obligatoria`
                            : t.kind === "TABLE"
                              ? `Mesa de ${peopleIn(t)} (número opcional)`
                              : "Entrada general"}
                      </span>
                    </li>
                  )),
                )}
              </ul>
            </details>
          </section>

          {staff.readOnly ? (
            <p className="card p-6 text-sm text-[var(--ink-muted)]">Tu cuenta es de solo lectura: las importaciones las hace iPass.</p>
          ) : (
            <section className="card space-y-3 p-6">
              <h2 className="eyebrow">2. Sube el archivo</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Se revisa todo antes de tocar el cupo: verás cada fila con su error (tipo que no existe, correo inválido,
                carnet repetido, butaca ocupada, sin cupo) y recién ahí confirmas.
              </p>
              <ActionForm action={uploadImportAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="eventId" value={event.id} />
                <label className="label min-w-[16rem] flex-1">
                  Archivo (.xlsx o .csv)
                  <input name="file" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required className="field" />
                </label>
                <button type="submit" className="btn btn-primary">
                  Revisar archivo
                </button>
              </ActionForm>
            </section>
          )}

          {!staff.readOnly && (
            <section className="card space-y-3 p-6">
              <h2 className="eyebrow">O: entradas que ya tienen su código (de otro proveedor)</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Para entradas ya vendidas por un tercero (o por ti) que la persona ya tiene, con su propio QR o código. Sube el archivo
                como venga: en una ventana eliges qué columna es el código, el nombre y el tipo de entrada. iPass no les manda otra
                entrada: en la puerta se leen con su propio código.
              </p>
              <p className="rounded-md bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">
                Para leer estas entradas, los teléfonos de puerta necesitan la app de puerta <strong>1.8.0</strong> o más nueva.
              </p>
              <p className="text-xs text-[var(--ink-dim)]">
                ¿El proveedor vendió butacas de un mapa y solo quieres que no se vendan dos veces? Bloquéalas en{" "}
                {active.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ", "}
                    <Link href={`/eventos/${event.id}/funciones/${s.id}/retenciones`} className="text-[var(--accent)] underline">
                      Retenciones{active.length > 1 ? ` (función ${i + 1})` : ""}
                    </Link>
                  </span>
                ))}
                : eliges las butacas en el mapa, por rango («A 1-20») o arrastrando.
              </p>
              <ExternalImport eventId={event.id} sessions={active.map((s) => s.label)} types={typeChoices} sections={generalSections} formats={formats.map((f) => ({ id: f.id, name: f.name, sourceName: f.sourceName, readMethod: f.readMethod === "BARCODE" ? "BARCODE" : "QR", mapping: f.mapping as unknown as ImportMapping, titles: f.titles as Record<string, string> }))} />
            </section>
          )}
        </>
      )}

      {batches.length > 0 && (
        <section className="card p-6">
          <h2 className="eyebrow mb-3">Importaciones de este evento</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {batches.map((b) => {
              const status = IMPORT_STATUS[b.status];
              return (
                <li key={b.id}>
                  <Link href={`/eventos/${event.id}/importar/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-[var(--surface-2)]">
                    <span>
                      <strong>{b.fileName}</strong>
                      <span className="block text-xs text-[var(--ink-dim)]">
                        {formatDateTime(b.createdAt, active[0]?.timeZone ?? "America/La_Paz")} · {b.staff.name}
                      </span>
                    </span>
                    <span className="flex items-center gap-3 font-mono text-xs text-[var(--ink-muted)]">
                      {b.validRows} de {b.totalRows} filas · {b.ticketCount} entradas
                      <span className={`badge ${status.className}`}>{status.text}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
