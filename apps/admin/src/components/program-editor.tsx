"use client";

import { useState } from "react";
import { MAX_PROGRAM_ITEMS, type ProgramItem } from "@ticketera/core";

type Row = ProgramItem & { key: number };
let counter = 0;
const row = (item?: Partial<ProgramItem>): Row => ({ key: counter++, time: item?.time ?? "", name: item?.name ?? "", note: item?.note ?? "" });

/**
 * Programa de la función: quién toca y a qué hora (hora del recinto). Va dentro de un ActionForm; las filas viajan
 * como JSON en el campo `program`.
 */
export function ProgramEditor({ initial }: { initial: ProgramItem[] }) {
  const [rows, setRows] = useState<Row[]>(() => (initial.length ? initial.map(row) : [row()]));
  const update = (key: number, patch: Partial<ProgramItem>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const items = rows.filter((r) => r.time && r.name.trim()).map(({ time, name, note }) => ({ time, name, note }));

  return (
    <div className="space-y-2">
      <input type="hidden" name="program" value={JSON.stringify(items)} />
      {rows.map((r) => (
        <div key={r.key} className="flex flex-wrap items-center gap-2">
          <input type="time" aria-label="Hora" value={r.time} onChange={(e) => update(r.key, { time: e.target.value })} className="field w-28" />
          <input aria-label="Artista o actividad" value={r.name} maxLength={80} placeholder="DJ, banda o actividad" onChange={(e) => update(r.key, { name: e.target.value })} className="field min-w-0 flex-1" />
          <input aria-label="Nota" value={r.note ?? ""} maxLength={120} placeholder="Nota (opcional)" onChange={(e) => update(r.key, { note: e.target.value })} className="field min-w-0 flex-1" />
          <button type="button" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [row()]))} aria-label="Quitar fila" className="px-2 text-[var(--danger)] hover:underline">
            ×
          </button>
        </div>
      ))}
      {rows.length < MAX_PROGRAM_ITEMS && (
        <button type="button" onClick={() => setRows((rs) => [...rs, row()])} className="text-sm text-[var(--accent)] hover:underline">
          + Agregar
        </button>
      )}
    </div>
  );
}
