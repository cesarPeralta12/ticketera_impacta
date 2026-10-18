"use client";

import { useMemo, useState } from "react";
import { CANVAS_HEIGHT, CANVAS_WIDTH, randomCode, type MapItem } from "@ticketera/core";
import { ActionForm } from "@/components/action-form";
import { MapDecor } from "@/components/map-decor";
import { holdSeatsAction, releaseHoldAction, unholdSeatsAction, updateHoldAction } from "@/lib/actions/holds";

export type HoldSeat = { id: string; label: string; x: number; y: number; sectionColor: string; r: number; sold: boolean; holdId: string | null };
export type HoldInfo = { id: string; name: string; color: string; code: string | null; seats: number; link: string | null };

/**
 * Mapa para apartar butacas: se tocan las butacas (o mesas, o sillas) y se crea una retención con nombre, color y
 * código, o se suman a una existente, o se sacan. Las vendidas no se pueden elegir. El color de cada retención solo
 * se ve en el panel; en la web aparecen ocupadas.
 */
export function HoldsEditor({ sessionId, seats, holds, items, readOnly }: { sessionId: string; seats: HoldSeat[]; holds: HoldInfo[]; items: MapItem[]; readOnly: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggested] = useState(() => randomCode(6));
  const holdById = useMemo(() => new Map(holds.map((h) => [h.id, h])), [holds]);
  const chosen = [...selected];
  const chosenHeld = chosen.filter((id) => seats.find((s) => s.id === id)?.holdId);

  function toggle(seat: HoldSeat) {
    if (seat.sold || readOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(seat.id)) next.delete(seat.id);
      else next.add(seat.id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} className="w-full min-w-[640px] select-none" style={{ background: "#fbfbf9" }} role="group" aria-label="Mapa para apartar butacas">
          <MapDecor items={items} />
          {seats.map((seat) => {
            const hold = seat.holdId ? holdById.get(seat.holdId) : undefined;
            const isSel = selected.has(seat.id);
            return (
              <circle
                key={seat.id}
                cx={seat.x}
                cy={seat.y}
                r={seat.r}
                fill={seat.sold ? "#d4d2c9" : hold ? hold.color : "#ffffff"}
                fillOpacity={hold ? 0.85 : 1}
                stroke={isSel ? "#14181b" : hold ? hold.color : seat.sectionColor}
                strokeWidth={isSel ? 3.5 : 2}
                role="checkbox"
                aria-checked={isSel}
                aria-disabled={seat.sold}
                aria-label={`${seat.label}${seat.sold ? " (vendida)" : hold ? ` (retención ${hold.name})` : ""}`}
                tabIndex={seat.sold || readOnly ? -1 : 0}
                className={seat.sold || readOnly ? "" : "cursor-pointer"}
                onClick={() => toggle(seat)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(seat);
                  }
                }}
              >
                <title>{`${seat.label}${seat.sold ? " · vendida" : hold ? ` · ${hold.name}` : ""}`}</title>
              </circle>
            );
          })}
        </svg>
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--ink-muted)]">
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-[var(--border)] bg-white" /> A la venta
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#d4d2c9]" /> Vendida
        </li>
        {holds.map((h) => (
          <li key={h.id} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full" style={{ background: h.color }} /> {h.name} ({h.seats})
          </li>
        ))}
      </ul>

      {!readOnly && (
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {chosen.length === 0 ? "Toca butacas en el mapa para elegirlas." : `${chosen.length} butaca(s) elegida(s)`}
            </p>
            {chosen.length > 0 && (
              <button type="button" className="text-xs text-[var(--accent)] hover:underline" onClick={() => setSelected(new Set())}>
                Limpiar selección
              </button>
            )}
          </div>
          {chosen.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-3">
              <ActionForm action={holdSeatsAction} onSuccess={() => setSelected(new Set())} className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
                <p className="text-sm font-medium">Nueva retención</p>
                <input type="hidden" name="sessionId" value={sessionId} />
                <input type="hidden" name="seatIds" value={chosen.join(",")} />
                <label className="label">
                  Nombre
                  <input name="name" required maxLength={40} placeholder="Prensa, Artista, Producción…" className="field" />
                </label>
                <div className="flex gap-2">
                  <label className="label">
                    Color
                    <input name="color" type="color" defaultValue="#7C3AED" className="h-[38px] w-14 cursor-pointer rounded border border-[var(--border)]" />
                  </label>
                  <label className="label flex-1">
                    Código para liberarlas (opcional)
                    <input name="code" maxLength={30} placeholder={`ej. ${suggested}`} className="field uppercase" />
                  </label>
                </div>
                <button type="submit" className="btn btn-dark w-fit">
                  Apartar {chosen.length}
                </button>
              </ActionForm>
              {holds.length > 0 && (
                <ActionForm action={holdSeatsAction} onSuccess={() => setSelected(new Set())} className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
                  <p className="text-sm font-medium">Sumar a una retención</p>
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <input type="hidden" name="seatIds" value={chosen.join(",")} />
                  <select name="holdId" className="field">
                    {holds.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn w-fit">
                    Sumar {chosen.length}
                  </button>
                </ActionForm>
              )}
              {chosenHeld.length > 0 && (
                <ActionForm action={unholdSeatsAction} onSuccess={() => setSelected(new Set())} className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
                  <p className="text-sm font-medium">Devolver a la venta</p>
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <input type="hidden" name="seatIds" value={chosenHeld.join(",")} />
                  <p className="text-xs text-[var(--ink-muted)]">{chosenHeld.length} de las elegidas están apartadas: salen de su retención.</p>
                  <button type="submit" className="btn w-fit">
                    Devolver {chosenHeld.length}
                  </button>
                </ActionForm>
              )}
            </div>
          )}
        </div>
      )}

      {holds.length > 0 && (
        <ul className="space-y-3">
          {holds.map((h) => (
            <li key={h.id} className="card space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="h-4 w-4 rounded-full" style={{ background: h.color }} />
                <strong>{h.name}</strong>
                <span className="text-sm text-[var(--ink-muted)]">· {h.seats} butaca(s)</span>
                {h.code && <span className="badge bg-[var(--surface-2)] font-mono">código {h.code}</span>}
              </div>
              {h.link && (
                <p className="break-all text-xs text-[var(--ink-muted)]">
                  Enlace para comprarlas: <span className="font-mono">{h.link}</span>
                </p>
              )}
              {!readOnly && (
                <div className="flex flex-wrap items-end gap-3">
                  <ActionForm action={updateHoldAction} successMessage="Guardado." className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <input type="hidden" name="holdId" value={h.id} />
                    <input name="name" defaultValue={h.name} maxLength={40} aria-label="Nombre" className="field w-40" />
                    <input name="color" type="color" defaultValue={h.color} aria-label="Color" className="h-[38px] w-12 cursor-pointer rounded border border-[var(--border)]" />
                    <input name="code" defaultValue={h.code ?? ""} maxLength={30} aria-label="Código" placeholder="sin código" className="field w-32 uppercase" />
                    <button type="submit" className="btn text-xs">
                      Guardar
                    </button>
                  </ActionForm>
                  <ActionForm action={releaseHoldAction} confirm={`¿Liberar "${h.name}"? Sus ${h.seats} butaca(s) vuelven a la venta.`}>
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <input type="hidden" name="holdId" value={h.id} />
                    <button type="submit" className="btn text-xs text-[var(--danger)]">
                      Liberar todo
                    </button>
                  </ActionForm>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
