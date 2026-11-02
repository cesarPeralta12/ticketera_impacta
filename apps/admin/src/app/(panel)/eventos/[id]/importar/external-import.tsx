"use client";

import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import {
  DEFAULT_CODE_RULE,
  FIELD_LABEL,
  columnLetter,
  normalizeExternalCode,
  valueKey,
  type ColumnSummary,
  type ExternalCodeRule,
  type ImportMapping,
  type MappableField,
} from "@ticketera/core";
import {
  analyzeExternalFileAction,
  createExternalImportAction,
  deleteImportFormatAction,
  saveImportFormatAction,
  type ExternalFileAnalysis,
} from "@/lib/actions/imports";

type Analysis = Exclude<ExternalFileAnalysis, { error: string }>;
export type TypeChoice = { name: string; detail: string };
/** Emparejamiento guardado para repetirlo con el mismo proveedor; `titles` es el título de la columna de cada dato. */
export type SavedFormat = { id: string; name: string; sourceName: string | null; readMethod: "QR" | "BARCODE"; mapping: ImportMapping; titles: Record<string, string> };

/** Los datos que se emparejan con columnas del archivo, en el orden de la ventana. */
const PERSON_FIELDS: MappableField[] = ["name", "document", "email", "place", "amount"];

/** Valor del archivo → el de iPass que tiene el mismo nombre (sin mayúsculas ni tildes), para empezar emparejado. */
function autoMatch(column: ColumnSummary | undefined, options: string[]) {
  const byKey = new Map(options.map((o) => [valueKey(o), o]));
  return Object.fromEntries((column?.distinct ?? []).flatMap((d) => (byKey.has(valueKey(d.value)) ? [[valueKey(d.value), byKey.get(valueKey(d.value))!]] : [])));
}

/**
 * Cargar entradas que ya existen (vendidas por otro proveedor, con su propio QR o código): se sube el archivo y en una
 * ventana se elige qué columna es cada dato, cómo se lee el código y a qué tipo de entrada corresponde cada valor.
 * Después se revisa fila por fila (como con la plantilla) y se confirma todo junto.
 */
export function ExternalImport({ eventId, sessions, types, formats }: { eventId: string; sessions: string[]; types: TypeChoice[]; formats: SavedFormat[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzing, startAnalyzing] = useTransition();
  const [columns, setColumns] = useState<ImportMapping["columns"]>({});
  const [fixed, setFixed] = useState<ImportMapping["fixed"]>({});
  const [values, setValues] = useState<ImportMapping["values"]>({});
  const [rule, setRule] = useState<ExternalCodeRule>(DEFAULT_CODE_RULE);
  const [tryCode, setTryCode] = useState("");
  const [readMethod, setReadMethod] = useState<"QR" | "BARCODE">("QR");
  const [sourceName, setSourceName] = useState("");
  const [formatName, setFormatName] = useState("");
  const [formatNote, setFormatNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingFormat, startSavingFormat] = useTransition();
  const [state, formAction, submitting] = useActionState(createExternalImportAction, undefined);
  const [, startSubmit] = useTransition();

  const typeNames = types.map((t) => t.name);
  const column = (field: MappableField) => (columns[field] === undefined ? undefined : analysis?.columns.find((c) => c.index === columns[field]));

  /** Lee el archivo (o lo vuelve a leer con otra hoja o fila de títulos) y abre la ventana con lo sugerido. */
  function analyze(options: { sheet?: string; headerRow?: number } = {}) {
    const form = formRef.current!;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) {
      setAnalyzeError("Elige el archivo primero.");
      return;
    }
    const data = new FormData();
    data.set("eventId", eventId);
    data.set("file", file);
    if (options.sheet) data.set("sheet", options.sheet);
    if (options.headerRow !== undefined) data.set("headerRow", String(options.headerRow));
    setAnalyzeError(null);
    startAnalyzing(async () => {
      const result = await analyzeExternalFileAction(data);
      if ("error" in result) {
        setAnalyzeError(result.error);
        return;
      }
      setAnalysis(result);
      setColumns(result.suggested);
      const typeColumn = result.columns.find((c) => c.index === result.suggested.type);
      const sessionColumn = result.columns.find((c) => c.index === result.suggested.session);
      setValues({ type: autoMatch(typeColumn, typeNames), session: autoMatch(sessionColumn, sessions) });
      setFixed((f) => ({ type: f.type ?? (types.length === 1 ? types[0]!.name : undefined), session: f.session ?? (sessions.length === 1 ? sessions[0] : undefined) }));
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
    });
  }

  /** Pone un formato guardado: busca cada columna por su título en este archivo y repite tipos, función y regla del código. */
  function applyFormat(id: string) {
    const format = formats.find((f) => f.id === id);
    if (!format || !analysis) return;
    const found: ImportMapping["columns"] = {};
    const missing: string[] = [];
    for (const [field, title] of Object.entries(format.titles) as [MappableField, string][]) {
      const match = analysis.columns.find((c) => valueKey(c.title) === valueKey(title));
      if (match) found[field] = match.index;
      else missing.push(`${FIELD_LABEL[field]} («${title}»)`);
    }
    const keep = (map: Record<string, string> | undefined, options: string[]) => Object.fromEntries(Object.entries(map ?? {}).filter(([, v]) => options.includes(v)));
    setColumns(found);
    setValues({ type: keep(format.mapping.values.type, typeNames), session: keep(format.mapping.values.session, sessions) });
    setFixed({
      type: format.mapping.fixed.type && typeNames.includes(format.mapping.fixed.type) ? format.mapping.fixed.type : undefined,
      session: format.mapping.fixed.session && sessions.includes(format.mapping.fixed.session) ? format.mapping.fixed.session : undefined,
    });
    setRule({ ...DEFAULT_CODE_RULE, ...format.mapping.codeRule });
    setReadMethod(format.readMethod);
    if (format.sourceName) setSourceName(format.sourceName);
    setFormatName(format.name);
    setFormatNote(
      missing.length > 0
        ? { ok: false, text: `En este archivo no hay columna para: ${missing.join(", ")}. Elígelas a mano.` }
        : { ok: true, text: `Formato «${format.name}» aplicado: revisa que todo esté bien.` },
    );
  }

  function saveFormat() {
    if (!mapping || !analysis) return;
    const titles = Object.fromEntries(Object.entries(columns).flatMap(([field, index]) => (index === undefined ? [] : [[field, analysis.columns.find((c) => c.index === index)?.title ?? ""]])));
    const data = new FormData();
    data.set("name", formatName);
    data.set("mapping", JSON.stringify(mapping));
    data.set("titles", JSON.stringify(titles));
    data.set("sourceName", sourceName);
    data.set("readMethod", readMethod);
    startSavingFormat(async () => {
      const result = await saveImportFormatAction(data);
      setFormatNote("error" in result ? { ok: false, text: result.error } : { ok: true, text: `Formato «${formatName.trim()}» guardado: la próxima vez lo eliges y ya queda armado.` });
    });
  }

  function removeFormat(id: string) {
    const data = new FormData();
    data.set("id", id);
    startSavingFormat(async () => {
      await deleteImportFormatAction(data);
      setFormatNote({ ok: true, text: "Formato borrado." });
    });
  }

  function setColumn(field: MappableField, raw: string) {
    const index = raw === "" ? undefined : Number(raw);
    setColumns((c) => ({ ...c, [field]: index }));
    if (field === "type" || field === "session") {
      const options = field === "type" ? typeNames : sessions;
      setValues((v) => ({ ...v, [field]: autoMatch(analysis?.columns.find((c) => c.index === index), options) }));
    }
  }

  const mapping: ImportMapping | null = analysis ? { headerRow: analysis.headerRow, columns, fixed, values, codeRule: rule } : null;
  const unmatched = (field: "type" | "session") => (column(field)?.distinct ?? []).filter((d) => !values[field]?.[valueKey(d.value)]);
  const problems = [
    columns.code === undefined && "Elige qué columna es el código de la entrada.",
    columns.type === undefined && !fixed.type && "Elige el tipo de entrada: una columna o uno para todas.",
    sessions.length > 1 && columns.session === undefined && !fixed.session && "El evento tiene varias funciones: elige una columna o una para todas.",
  ].filter((p): p is string => Boolean(p));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mapping || problems.length > 0) return;
    const data = new FormData(event.currentTarget);
    data.set("mapping", JSON.stringify(mapping));
    if (analysis?.sheet) data.set("sheet", analysis.sheet);
    startSubmit(() => formAction(data));
  }

  const codeSamples = column("code")?.samples ?? [];

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="eventId" value={eventId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="label min-w-[16rem] flex-1">
          Archivo (.xlsx o .csv), con cualquier formato
          <input
            name="file"
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            className="field"
            onChange={() => {
              setAnalysis(null);
              setAnalyzeError(null);
            }}
          />
        </label>
        <label className="label">
          De dónde vienen (opcional)
          <input name="sourceName" value={sourceName} onChange={(e) => setSourceName(e.target.value)} maxLength={80} placeholder="ej. TuBoleto" className="field w-44" />
        </label>
        <button type="button" onClick={() => analyze()} disabled={analyzing} className="btn btn-primary">
          {analyzing ? "Leyendo…" : "Elegir columnas"}
        </button>
      </div>
      {analyzeError && <p className="text-sm text-[var(--danger)]">{analyzeError}</p>}
      {analysis && !analyzeError && (
        <p className="text-sm text-[var(--ink-muted)]">
          {analysis.fileName}: {analysis.rowCount} fila(s).{" "}
          <button type="button" onClick={() => dialogRef.current?.showModal()} className="text-[var(--accent)] underline">
            Ver el emparejamiento
          </button>
        </p>
      )}

      <dialog
        ref={dialogRef}
        aria-label="¿Qué es cada columna?"
        className="m-auto w-[min(64rem,calc(100vw-2rem))] max-w-none rounded-xl border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--ink)] shadow-2xl backdrop:bg-black/40"
      >
        {analysis && (
          <div className="flex max-h-[88vh] flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
              <h2 className="font-semibold">¿Qué es cada columna?</h2>
              <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Cerrar" className="rounded p-1 text-lg leading-none text-[var(--ink-muted)] hover:bg-[var(--surface-2)]">
                ×
              </button>
            </div>

            <div className="space-y-6 overflow-y-auto px-5 py-4">
              {formats.length > 0 && (
                <section className="flex flex-wrap items-end gap-3">
                  <label className="label min-w-[16rem]">
                    Formato guardado
                    <select defaultValue="" onChange={(e) => applyFormat(e.target.value)} className="field">
                      <option value="">— elegir uno para no emparejar a mano —</option>
                      {formats.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                          {f.sourceName ? ` · ${f.sourceName}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
              )}
              {/* 1. Hoja, fila de títulos y las primeras filas del archivo */}
              <section className="space-y-2">
                <div className="flex flex-wrap items-end gap-3">
                  {analysis.sheets.length > 1 && (
                    <label className="label">
                      Hoja
                      <select value={analysis.sheet} onChange={(e) => analyze({ sheet: e.target.value })} className="field">
                        {analysis.sheets.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="label">
                    Fila de títulos
                    <select value={analysis.headerRow} onChange={(e) => analyze({ sheet: analysis.sheet || undefined, headerRow: Number(e.target.value) })} className="field">
                      {analysis.preview.map((row, i) => (
                        <option key={i} value={i}>
                          Fila {i + 1}: {row.filter(Boolean).slice(0, 3).join(" · ").slice(0, 50) || "(vacía)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="pb-2 text-xs text-[var(--ink-dim)]">{analysis.rowCount} fila(s) con datos debajo de los títulos.</p>
                </div>
                <div className="overflow-x-auto rounded-md border border-[var(--border)]">
                  <table className="w-full text-xs">
                    <thead className="bg-[var(--surface-2)] text-left">
                      <tr>
                        {analysis.columns.map((c) => (
                          <th key={c.index} className="whitespace-nowrap px-2 py-1.5 font-medium">
                            <span className="text-[var(--ink-dim)]">{columnLetter(c.index)} · </span>
                            {c.title}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.preview.slice(analysis.headerRow + 1, analysis.headerRow + 6).map((row, i) => (
                        <tr key={i} className="border-t border-[var(--border)]">
                          {analysis.columns.map((c) => (
                            <td key={c.index} className="max-w-48 truncate whitespace-nowrap px-2 py-1">
                              {row[c.index]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 2. Cada dato de iPass con su columna */}
              <section className="space-y-3">
                <h3 className="eyebrow">Los datos</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(["code", ...PERSON_FIELDS] as MappableField[]).map((field) => (
                    <label key={field} className="label">
                      {FIELD_LABEL[field]}
                      {field === "code" && <span className="text-[var(--danger)]"> *</span>}
                      <select value={columns[field] ?? ""} onChange={(e) => setColumn(field, e.target.value)} className="field">
                        <option value="">— no está en el archivo —</option>
                        {analysis.columns.map((c) => (
                          <option key={c.index} value={c.index}>
                            {columnLetter(c.index)} · {c.title}
                            {c.samples[0] ? ` (ej. ${c.samples[0].slice(0, 24)})` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-[var(--ink-dim)]">
                  Sin nombre se muestra «Sin nombre» en la puerta. Una fila sin código recibe uno propio de iPass. El monto vacío es cortesía.
                </p>
              </section>

              {/* 3. Tipo de entrada y función: una columna (emparejando cada valor) o uno para todas */}
              {([["type", "Tipo de entrada", typeNames], ...(sessions.length > 1 ? [["session", "Función", sessions]] : [])] as ["type" | "session", string, string[]][]).map(
                ([field, label, options]) => (
                  <section key={field} className="space-y-3">
                    <h3 className="eyebrow">{label}</h3>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="label">
                        Columna del archivo
                        <select value={columns[field] ?? ""} onChange={(e) => setColumn(field, e.target.value)} className="field">
                          <option value="">— no está: uno para todas —</option>
                          {analysis.columns.map((c) => (
                            <option key={c.index} value={c.index}>
                              {columnLetter(c.index)} · {c.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      {columns[field] === undefined && (
                        <label className="label min-w-[14rem]">
                          {field === "type" ? "Todas son" : "Todas son de"}
                          <select value={fixed[field] ?? ""} onChange={(e) => setFixed((f) => ({ ...f, [field]: e.target.value || undefined }))} className="field">
                            <option value="">Elige…</option>
                            {options.map((o) => (
                              <option key={o}>{o}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    {field === "type" && columns.type === undefined && fixed.type && (
                      <p className="text-xs text-[var(--ink-dim)]">{types.find((t) => t.name === fixed.type)?.detail}</p>
                    )}
                    {columns[field] !== undefined && (
                      <div className="overflow-x-auto rounded-md border border-[var(--border)]">
                        <table className="w-full text-sm">
                          <thead className="bg-[var(--surface-2)] text-left text-xs">
                            <tr>
                              <th className="px-3 py-1.5 font-medium">En el archivo</th>
                              <th className="px-3 py-1.5 text-right font-medium">Filas</th>
                              <th className="px-3 py-1.5 font-medium">En iPass</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(column(field)?.distinct ?? []).map((d) => {
                              const key = valueKey(d.value);
                              const chosen = values[field]?.[key] ?? "";
                              return (
                                <tr key={key} className="border-t border-[var(--border)]">
                                  <td className="px-3 py-1.5">{d.value}</td>
                                  <td className="px-3 py-1.5 text-right font-mono text-xs">{d.count}</td>
                                  <td className="px-3 py-1.5">
                                    <select
                                      value={chosen}
                                      onChange={(e) => setValues((v) => ({ ...v, [field]: { ...v[field], [key]: e.target.value } }))}
                                      className={`field py-1 ${chosen ? "" : "border-[var(--warn)]"}`}
                                    >
                                      <option value="">Sin emparejar (esas filas quedan con error)</option>
                                      {options.map((o) => (
                                        <option key={o}>{o}</option>
                                      ))}
                                    </select>
                                    {field === "type" && chosen && <span className="ml-2 text-xs text-[var(--ink-dim)]">{types.find((t) => t.name === chosen)?.detail}</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {(column(field)?.distinctCount ?? 0) > (column(field)?.distinct.length ?? 0) && (
                          <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--warn)]">
                            Esta columna tiene {column(field)?.distinctCount} valores distintos: ¿es la columna correcta?
                          </p>
                        )}
                      </div>
                    )}
                    {columns[field] !== undefined && unmatched(field).length > 0 && (
                      <p className="text-xs text-[var(--warn)]">{unmatched(field).length} valor(es) sin emparejar: esas filas van a quedar con error.</p>
                    )}
                  </section>
                ),
              )}

              {/* 4. Cómo se lee el código */}
              <section className="space-y-3">
                <h3 className="eyebrow">¿Cómo se lee el código?</h3>
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="readMethod" value="QR" checked={readMethod === "QR"} onChange={() => setReadMethod("QR")} /> Viene en un QR
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="readMethod" value="BARCODE" checked={readMethod === "BARCODE"} onChange={() => setReadMethod("BARCODE")} /> Viene en un código de barras
                  </label>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={rule.ignoreSeparators} onChange={(e) => setRule((r) => ({ ...r, ignoreSeparators: e.target.checked }))} />
                    Ignorar guiones y espacios (ABC-123 = ABC123)
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={rule.fromUrl} onChange={(e) => setRule((r) => ({ ...r, fromUrl: e.target.checked }))} />
                    Si el QR trae un enlace, usar el código del final
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={rule.ignoreLeadingZeros} onChange={(e) => setRule((r) => ({ ...r, ignoreLeadingZeros: e.target.checked }))} />
                    00123 = 123 (ceros a la izquierda no cuentan)
                  </label>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="label">
                    Quitar prefijo (opcional)
                    <input value={rule.prefix} onChange={(e) => setRule((r) => ({ ...r, prefix: e.target.value }))} maxLength={20} placeholder="ej. TKT-" className="field w-32" />
                  </label>
                  <label className="label">
                    Quitar sufijo (opcional)
                    <input value={rule.suffix} onChange={(e) => setRule((r) => ({ ...r, suffix: e.target.value }))} maxLength={20} className="field w-32" />
                  </label>
                  <label className="label">
                    Probar una lectura
                    <input value={tryCode} onChange={(e) => setTryCode(e.target.value)} placeholder="escribe o pega un código" className="field w-56" />
                  </label>
                </div>
                <ul className="space-y-1 text-sm">
                  {[...codeSamples, ...(tryCode ? [tryCode] : [])].map((sample, i) => (
                    <li key={`${i}-${sample}`} className="font-mono text-xs">
                      {sample.slice(0, 60)} <span className="text-[var(--ink-dim)]">→ la puerta busca</span> <strong>{normalizeExternalCode(sample, rule) ?? "(no se puede leer)"}</strong>
                    </li>
                  ))}
                  {codeSamples.length === 0 && <li className="text-xs text-[var(--ink-dim)]">Elige la columna del código para ver cómo se leen.</li>}
                </ul>
              </section>
            </div>

            <div className="space-y-2 border-t border-[var(--border)] px-5 py-3">
              {problems.map((p) => (
                <p key={p} className="text-sm text-[var(--warn)]">
                  {p}
                </p>
              ))}
              {state?.error && (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  {state.error}
                </p>
              )}
              <div className="flex flex-wrap items-end gap-2 border-b border-[var(--border)] pb-3">
                <label className="label">
                  Guardar este emparejamiento como formato
                  <input value={formatName} onChange={(e) => setFormatName(e.target.value)} maxLength={80} placeholder="ej. TuBoleto 2026" className="field w-56" />
                </label>
                <button type="button" onClick={saveFormat} disabled={!formatName.trim() || problems.length > 0 || savingFormat} className="btn disabled:cursor-not-allowed disabled:opacity-50">
                  Guardar formato
                </button>
                {formats.find((f) => f.name === formatName.trim()) && (
                  <button type="button" onClick={() => removeFormat(formats.find((f) => f.name === formatName.trim())!.id)} disabled={savingFormat} className="text-sm text-[var(--danger)] underline">
                    Borrar este formato
                  </button>
                )}
                {formatNote && <p className={`text-sm ${formatNote.ok ? "text-[var(--ink-muted)]" : "text-[var(--warn)]"}`}>{formatNote.text}</p>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[var(--ink-dim)]">Todavía no ocupa cupo: en el paso siguiente ves cada fila con su error y recién ahí confirmas.</p>
                <button type="submit" disabled={problems.length > 0 || submitting} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50">
                  {submitting ? "Revisando…" : `Revisar ${analysis.rowCount} fila(s)`}
                </button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </form>
  );
}
