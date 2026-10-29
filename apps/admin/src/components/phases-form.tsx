"use client";

import { useState } from "react";
import { MAX_PHASES } from "@ticketera/core";
import { ActionForm } from "@/components/action-form";
import { createPhasesAction } from "@/lib/actions/phases";

type SectionOption = { id: string; name: string; capacity: number };

/** Lo de siempre en un carnaval o festival: una fase hot corta y después las fases que van subiendo de precio. */
const SUGGESTED = ["Fase Hot", "Fase 1", "Fase 2", "Fase 3"];

/**
 * Formulario para crear las fases de venta de una sección general: nombre, precio y cupo de cada una, y (desde la
 * segunda) una fecha opcional para empezar aunque la anterior no se haya agotado.
 */
export function PhasesForm({ sessionId, sections }: { sessionId: string; sections: SectionOption[] }) {
  // Ids estables: al quitar una fase del medio, las demás conservan lo que se escribió.
  const [rows, setRows] = useState(() => SUGGESTED.map((name, i) => ({ key: i, name })));
  const [next, setNext] = useState(SUGGESTED.length);

  function addRow() {
    setRows((r) => [...r, { key: next, name: `Fase ${r.length}` }]);
    setNext((n) => n + 1);
  }

  return (
    <ActionForm action={createPhasesAction} resetOnSuccess className="space-y-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="label">
          Sección
          <select name="sectionId" required className="field">
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — aforo {s.capacity}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          La primera fase se vende desde
          <input type="datetime-local" name="firstStartsAt" className="field" />
          <span className="text-xs font-normal text-[var(--ink-dim)]">Vacío: desde ya.</span>
        </label>
        <label className="label">
          Máx. por compra
          <input name="maxPerOrder" type="number" min={1} max={10} defaultValue={10} className="field w-24" />
        </label>
        <fieldset className="label">
          <legend className="mb-1.5">Reingreso</legend>
          <div className="flex h-[38px] items-center gap-4 text-sm text-[var(--ink)]">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="reentry" value="no" defaultChecked className="accent-[var(--accent)]" /> No
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="reentry" value="yes" className="accent-[var(--accent)]" /> Sí
            </label>
          </div>
        </fieldset>
      </div>

      <ol className="space-y-2">
        {rows.map((row, i) => (
          <li key={row.key} className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] p-3">
            <span className="tone-magenta tone-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-semibold">{i + 1}</span>
            <label className="label">
              Nombre
              <input name={`name${i}`} required defaultValue={row.name} className="field w-36" />
            </label>
            <label className="label">
              Precio (Bs)
              <input name={`price${i}`} required inputMode="decimal" placeholder="ej. 150" className="field w-28" />
            </label>
            <label className="label">
              Cupo
              <input name={`capacity${i}`} required type="number" min={1} placeholder="ej. 300" className="field w-28" />
            </label>
            {i === 0 ? (
              <p className="pb-2 text-xs text-[var(--ink-dim)]">Se vende primero.</p>
            ) : (
              <label className="label">
                Empieza el (opcional)
                <input type="datetime-local" name={`startsAt${i}`} className="field" />
                <span className="text-xs font-normal text-[var(--ink-dim)]">Vacío: cuando se agote la anterior.</span>
              </label>
            )}
            {rows.length > 2 && (
              <button type="button" onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))} className="pb-2 text-xs text-[var(--danger)] hover:underline">
                Quitar
              </button>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        {rows.length < MAX_PHASES && (
          <button type="button" onClick={addRow} className="btn px-3 py-1.5 text-sm">
            + Agregar otra fase
          </button>
        )}
        <button type="submit" className="btn btn-primary px-4 py-1.5 text-sm">
          Crear las fases
        </button>
      </div>
      <p className="text-xs text-[var(--ink-dim)]">
        En la web se ve una sola fase a la vez, con el resto de las fases y sus precios a un lado. La siguiente empieza
        cuando se agota la anterior o cuando llega su fecha, lo que pase primero. Una fase que terminó no vuelve.
      </p>
    </ActionForm>
  );
}
