"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { MapItem } from "@ticketera/core";
import { SeatSelectMap, type MapSeat } from "@/components/seat-select-map";
import { assignImportSeatsAction } from "@/lib/actions/imports";

/** Orden natural de las butacas elegidas: por fila y número, que es como se las asigna a las filas del archivo. */
function byPlace(a: MapSeat, b: MapSeat) {
  return a.row.localeCompare(b.row, undefined, { numeric: true }) || Number(a.number) - Number(b.number) || a.label.localeCompare(b.label);
}

export function AssignSeats({
  batchId,
  backHref,
  rows,
  seats,
  items,
  readOnly,
  canDrag,
  holdNames,
}: {
  batchId: string;
  backHref: string;
  rows: { line: number; name: string }[];
  seats: MapSeat[];
  items: MapItem[];
  readOnly: boolean;
  canDrag: boolean;
  holdNames: { name: string; color: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const chosen = useMemo(() => seats.filter((s) => selected.has(s.id)).sort(byPlace), [seats, selected]);
  const pairs = chosen.slice(0, rows.length).map((seat, i) => ({ row: rows[i]!, seat }));
  const tooMany = chosen.length > rows.length;

  function assign() {
    const data = new FormData();
    data.set("batchId", batchId);
    data.set("assignments", JSON.stringify(pairs.map((p) => ({ line: p.row.line, seatId: p.seat.id }))));
    startSaving(async () => {
      const result = await assignImportSeatsAction(data);
      if ("error" in result) {
        setNote({ ok: false, text: result.error });
        return;
      }
      setSelected(new Set());
      setNote({ ok: true, text: result.message });
      if (result.remaining === 0) router.push(backHref);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <SeatSelectMap
        seats={seats}
        items={items}
        selected={selected}
        setSelected={setSelected}
        readOnly={readOnly}
        canDrag={canDrag}
        ariaLabel="Mapa para asignar butacas"
        legend={
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--ink-muted)]">
            <li className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full border-2 border-[var(--border)] bg-white" /> Libre
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#d4d2c9]" /> Ocupada (vendida o ya en este archivo)
            </li>
            {holdNames.map((h) => (
              <li key={h.name} className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full" style={{ background: h.color }} /> Retención {h.name}
              </li>
            ))}
          </ul>
        }
      />

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {chosen.length} butaca(s) elegida(s) · {rows.length} fila(s) esperando
          </p>
          {chosen.length > 0 && (
            <button type="button" className="text-xs text-[var(--accent)] hover:underline" onClick={() => setSelected(new Set())}>
              Limpiar selección
            </button>
          )}
        </div>
        {pairs.length > 0 && (
          <ul className="max-h-48 space-y-0.5 overflow-y-auto text-sm">
            {pairs.map((p) => (
              <li key={p.row.line} className="flex justify-between gap-3">
                <span>
                  <span className="text-[var(--ink-dim)]">Fila {p.row.line} · </span>
                  {p.row.name}
                </span>
                <span className="font-mono">{p.seat.label}</span>
              </li>
            ))}
          </ul>
        )}
        {tooMany && <p className="text-sm text-[var(--warn)]">Elegiste más butacas que filas: se usan solo las primeras {rows.length}.</p>}
        {note && <p className={`text-sm ${note.ok ? "text-[var(--ink-muted)]" : "text-[var(--danger)]"}`}>{note.text}</p>}
        <button
          type="button"
          onClick={assign}
          disabled={readOnly || pairs.length === 0 || saving}
          className="btn btn-primary w-fit disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Asignando…" : `Asignar ${pairs.length} butaca(s)`}
        </button>
      </div>
    </div>
  );
}
