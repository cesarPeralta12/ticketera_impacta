"use client";

/**
 * Editor visual de mapas de butacas — portado del prototipo del compañero.
 * Cambios: se diseña una vez por recinto (no por función) y sin precio: el precio de cada
 * sección se define por función, en sus tipos de entrada.
 */
import { useRef, useState, useTransition } from "react";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_ROWS,
  MAX_SEATS_PER_ROW,
  SECTION_COLORS,
  computeSeatPositions,
  type SectionShape,
} from "@ticketera/core";
import { addSeatSectionAction } from "@/lib/actions/venues";

type ExistingSection = {
  id: string;
  name: string;
  color: string;
  seats: { x: number; y: number }[];
};

const fieldClass = "field";

export function SeatDesigner({
  venueId,
  existingSections,
}: {
  venueId: string;
  existingSections: ExistingSection[];
}) {
  const [shapeType, setShapeType] = useState<"grid" | "arc">("grid");
  const [name, setName] = useState("");
  const [color, setColor] = useState(SECTION_COLORS[0]!);
  const [rows, setRows] = useState(5);
  const [seatsPerRow, setSeatsPerRow] = useState(10);

  const [gridX, setGridX] = useState(CANVAS_WIDTH / 2 - 120);
  const [gridY, setGridY] = useState(220);
  const [seatGap, setSeatGap] = useState(26);
  const [rowGap, setRowGap] = useState(26);

  const [centerX, setCenterX] = useState(CANVAS_WIDTH / 2);
  const [centerY, setCenterY] = useState(40);
  const [startRadius, setStartRadius] = useState(220);
  const [arcRowGap, setArcRowGap] = useState(28);
  const [startAngleDeg, setStartAngleDeg] = useState(20);
  const [spanDeg, setSpanDeg] = useState(140);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    startPx: number;
    startPy: number;
    startX: number;
    startY: number;
  } | null>(null);

  const shape: SectionShape =
    shapeType === "grid"
      ? { type: "grid", rows, seatsPerRow, x: gridX, y: gridY, seatGap, rowGap }
      : {
          type: "arc",
          rows,
          seatsPerRow,
          centerX,
          centerY,
          startRadius,
          rowGap: arcRowGap,
          startAngleDeg,
          spanDeg,
        };

  const previewSeats = computeSeatPositions(shape);
  const xs = previewSeats.map((s) => s.x);
  const ys = previewSeats.map((s) => s.y);
  const minX = Math.min(...xs) - 18;
  const maxX = Math.max(...xs) + 18;
  const minY = Math.min(...ys) - 18;
  const maxY = Math.max(...ys) + 18;

  function toSvgPoint(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  }

  function handleDragStart(e: React.PointerEvent<SVGRectElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toSvgPoint(e.clientX, e.clientY);
    dragRef.current = {
      startPx: p.x,
      startPy: p.y,
      startX: shapeType === "grid" ? gridX : centerX,
      startY: shapeType === "grid" ? gridY : centerY,
    };
  }

  function handleDragMove(e: React.PointerEvent<SVGRectElement>) {
    if (!dragRef.current) return;
    const p = toSvgPoint(e.clientX, e.clientY);
    const dx = p.x - dragRef.current.startPx;
    const dy = p.y - dragRef.current.startPy;
    if (shapeType === "grid") {
      setGridX(Math.round(dragRef.current.startX + dx));
      setGridY(Math.round(dragRef.current.startY + dy));
    } else {
      setCenterX(Math.round(dragRef.current.startX + dx));
      setCenterY(Math.round(dragRef.current.startY + dy));
    }
  }

  function handleDragEnd() {
    dragRef.current = null;
  }

  function handleSubmit() {
    setError(null);
    if (!name.trim()) {
      setError("Ponle un nombre a la sección.");
      return;
    }
    const fd = new FormData();
    fd.set("venueId", venueId);
    fd.set("name", name);
    fd.set("color", color);
    fd.set("shape", JSON.stringify(shape));

    startTransition(async () => {
      const result = await addSeatSectionAction(undefined, fd);
      if (result?.error) setError(result.error);
      else setName("");
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          className="w-full touch-none select-none"
          style={{ background: "#fbfbf9" }}
        >
          <rect
            x={CANVAS_WIDTH / 2 - 160}
            y={16}
            width={320}
            height={20}
            rx={4}
            fill="#1a1a18"
          />
          <text
            x={CANVAS_WIDTH / 2}
            y={30}
            textAnchor="middle"
            fontSize="10"
            letterSpacing="2"
            fill="#fff"
          >
            ESCENARIO
          </text>

          {existingSections.map((s) => (
            <g key={s.id}>
              {s.seats.map((seat, i) => (
                <circle
                  key={i}
                  cx={seat.x}
                  cy={seat.y}
                  r={5}
                  fill={s.color}
                  opacity={0.5}
                />
              ))}
            </g>
          ))}

          <rect
            x={minX}
            y={minY}
            width={maxX - minX}
            height={maxY - minY}
            rx={12}
            fill={color}
            opacity={0.1}
            stroke={color}
            strokeDasharray="5 4"
            style={{ cursor: "grab", touchAction: "none" }}
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
          />
          {previewSeats.map((s, i) => (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={6}
              fill={color}
              stroke="#1a1a18"
              strokeWidth={0.5}
              style={{ pointerEvents: "none" }}
            />
          ))}
        </svg>
        <p className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--ink-dim)]">
          Arrastra el área punteada para ubicar la sección nueva. {previewSeats.length} butacas.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {existingSections.length > 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Secciones cargadas
            </h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {existingSections.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="flex-1">{s.name}</span>
                  <span className="font-mono text-xs text-[var(--ink-dim)]">{s.seats.length} butacas</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Nueva sección
          </h3>

          <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
            Nombre
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Platea"
              className={fieldClass}
            />
          </label>

          <div className="flex gap-4">
            <div className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
              Color
              <div className="flex gap-1">
                {SECTION_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    onClick={() => setColor(c)}
                    className="h-6 w-6 rounded-full"
                    style={{
                      background: c,
                      outline: color === c ? "2px solid var(--ink)" : "none",
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 rounded-md bg-[var(--surface-2)] p-1 text-sm">
            <button
              type="button"
              onClick={() => setShapeType("grid")}
              className={`flex-1 rounded px-3 py-1.5 transition-colors ${shapeType === "grid" ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--ink-muted)]"}`}
            >
              Grilla
            </button>
            <button
              type="button"
              onClick={() => setShapeType("arc")}
              className={`flex-1 rounded px-3 py-1.5 transition-colors ${shapeType === "arc" ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--ink-muted)]"}`}
            >
              Arco
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
              Filas
              <input
                type="number"
                min={1}
                max={MAX_ROWS}
                value={rows}
                onChange={(e) => setRows(Number(e.target.value))}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
              Butacas/fila
              <input
                type="number"
                min={1}
                max={MAX_SEATS_PER_ROW}
                value={seatsPerRow}
                onChange={(e) => setSeatsPerRow(Number(e.target.value))}
                className={fieldClass}
              />
            </label>
          </div>

          {shapeType === "grid" ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                Espacio entre butacas
                <input
                  type="number"
                  min={12}
                  value={seatGap}
                  onChange={(e) => setSeatGap(Number(e.target.value))}
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                Espacio entre filas
                <input
                  type="number"
                  min={12}
                  value={rowGap}
                  onChange={(e) => setRowGap(Number(e.target.value))}
                  className={fieldClass}
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                Radio inicial
                <input
                  type="number"
                  min={20}
                  value={startRadius}
                  onChange={(e) => setStartRadius(Number(e.target.value))}
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                Espacio entre filas
                <input
                  type="number"
                  min={12}
                  value={arcRowGap}
                  onChange={(e) => setArcRowGap(Number(e.target.value))}
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                Ángulo inicial
                <input
                  type="number"
                  value={startAngleDeg}
                  onChange={(e) => setStartAngleDeg(Number(e.target.value))}
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                Apertura (°)
                <input
                  type="number"
                  min={10}
                  max={360}
                  value={spanDeg}
                  onChange={(e) => setSpanDeg(Number(e.target.value))}
                  className={fieldClass}
                />
              </label>
            </div>
          )}

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Agregando…" : "+ Agregar sección al mapa"}
          </button>
        </div>
      </div>
    </div>
  );
}
