"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  resolveSeatRanges,
  type MapItem,
} from "@ticketera/core";
import { MapDecor } from "@/components/map-decor";

/** Una butaca (o mesa, o silla) del mapa. `sold`: no se puede elegir. `mark`: color y nombre de una retención. */
export type MapSeat = {
  id: string;
  label: string;
  section: string;
  row: string;
  number: string;
  x: number;
  y: number;
  sectionColor: string;
  r: number;
  sold: boolean;
  mark: { name: string; color: string } | null;
};

/**
 * Mapa de butacas para elegir varias: se tocan una por una, se escribe un rango («A 1-20, 40-50») o, solo el superadmin
 * con mouse, se arrastra un recuadro. Quien lo usa guarda la selección y decide qué hacer con ella.
 */
export function SeatSelectMap({
  seats,
  items,
  selected,
  setSelected,
  readOnly,
  canDrag,
  ariaLabel,
  legend,
}: {
  seats: MapSeat[];
  items: MapItem[];
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  readOnly: boolean;
  canDrag: boolean;
  ariaLabel: string;
  legend?: ReactNode;
}) {
  const [rangeText, setRangeText] = useState("");
  const [rangeNote, setRangeNote] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  /** Recuadro que se está arrastrando, en coordenadas del mapa. */
  const [box, setBox] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const justDragged = useRef(false);

  /** Elige las butacas libres que cubre el texto («A 1-20, 40-50»); suma a lo que ya está elegido. */
  function applyRange() {
    const found = resolveSeatRanges(rangeText, seats);
    const free = found.ids.filter(
      (id) => !seats.find((s) => s.id === id)?.sold,
    );
    const soldCount = found.ids.length - free.length;
    setSelected((prev) => new Set([...prev, ...free]));
    const problems = [
      ...found.invalid.map((t) => `«${t}» no se entiende`),
      ...found.empty.map((t) => `«${t}» no encontró butacas`),
    ];
    setRangeNote({
      ok: problems.length === 0,
      text: `${free.length} butaca(s) elegida(s)${soldCount ? `, ${soldCount} ya vendida(s) quedan fuera` : ""}${problems.length ? `. Revisa: ${problems.join("; ")}.` : "."}`,
    });
  }

  // Arrastrar para elegir (solo el superadmin, con el mouse): todo lo que cae dentro del recuadro se suma a la selección.
  useEffect(() => {
    if (!box) return;
    const svg = svgRef.current;
    if (!svg) return;
    const point = (e: PointerEvent) => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
        ctm.inverse(),
      );
      return { x: p.x, y: p.y };
    };
    const move = (e: PointerEvent) => {
      const p = point(e);
      setBox((b) => (b ? { ...b, x2: p.x, y2: p.y } : b));
    };
    const up = (e: PointerEvent) => {
      const p = point(e);
      setBox((b) => {
        if (!b) return null;
        const x1 = Math.min(b.x1, p.x);
        const x2 = Math.max(b.x1, p.x);
        const y1 = Math.min(b.y1, p.y);
        const y2 = Math.max(b.y1, p.y);
        // Un toque corto no es arrastre: lo atiende el clic de la butaca.
        if (x2 - x1 > 6 || y2 - y1 > 6) {
          justDragged.current = true;
          setTimeout(() => (justDragged.current = false), 0);
          const inside = seats
            .filter(
              (s) =>
                !s.sold && s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2,
            )
            .map((s) => s.id);
          setSelected((prev) => new Set([...prev, ...inside]));
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [box !== null, seats]); // eslint-disable-line react-hooks/exhaustive-deps

  function startDrag(e: React.PointerEvent<SVGSVGElement>) {
    if (!canDrag || readOnly || e.pointerType !== "mouse" || e.button !== 0)
      return;
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    setBox({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  }

  function toggle(seat: MapSeat) {
    if (seat.sold || readOnly || justDragged.current) return;
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
        <svg
          ref={svgRef}
          onPointerDown={startDrag}
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          className="w-full min-w-[640px] select-none"
          style={{ background: "#fbfbf9" }}
          role="group"
          aria-label={ariaLabel}
        >
          <MapDecor items={items} />
          {seats.map((seat) => {
            const hold = seat.mark;
            const isSel = selected.has(seat.id);
            return (
              <circle
                key={seat.id}
                cx={seat.x}
                cy={seat.y}
                r={seat.r}
                fill={seat.sold ? "#d4d2c9" : hold ? hold.color : "#ffffff"}
                fillOpacity={hold ? 0.85 : 1}
                stroke={
                  isSel ? "#14181b" : hold ? hold.color : seat.sectionColor
                }
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
          {box && (
            <rect
              x={Math.min(box.x1, box.x2)}
              y={Math.min(box.y1, box.y2)}
              width={Math.abs(box.x2 - box.x1)}
              height={Math.abs(box.y2 - box.y1)}
              fill="#7C3AED"
              fillOpacity={0.12}
              stroke="#7C3AED"
              strokeDasharray="6 4"
              pointerEvents="none"
            />
          )}
        </svg>
      </div>
      {legend}

      {!readOnly && (
        <div className="card space-y-2 p-4">
          <label className="label">
            Elegir por rango
            <div className="flex flex-wrap gap-2">
              <input
                value={rangeText}
                onChange={(e) => setRangeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyRange();
                  }
                }}
                placeholder="ej. A 1-20, B 40-50, 7"
                className="field min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={applyRange}
                disabled={!rangeText.trim()}
                className="btn disabled:cursor-not-allowed disabled:opacity-50"
              >
                Elegir
              </button>
            </div>
          </label>
          <p className="text-xs text-[var(--ink-dim)]">
            Escribe la fila y el rango de números («A 1-20»); sin fila vale para
            todas. Separa con comas.
            {canDrag &&
              " También puedes arrastrar un recuadro sobre el mapa para elegir varias a la vez (solo con mouse)."}
          </p>
          {rangeNote && (
            <p
              className={`text-sm ${rangeNote.ok ? "text-[var(--ink-muted)]" : "text-[var(--warn)]"}`}
            >
              {rangeNote.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
