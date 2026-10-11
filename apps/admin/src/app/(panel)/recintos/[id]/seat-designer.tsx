"use client";

/**
 * Editor visual de mapas de butacas — portado del prototipo del compañero.
 * Cambios: se diseña una vez por recinto (no por función), sin precio (el precio de cada
 * sección se define por función), y permite editar y borrar secciones existentes y avisa
 * cuando una sección se superpone con otra.
 */
import { useRef, useState, useTransition } from "react";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_ROWS,
  MAX_SEATS_PER_ROW,
  SECTION_COLORS,
  computeSeatPositions,
  zoneLabelPoint,
  zonePath,
  type SectionShape,
  type ZoneShape,
} from "@ticketera/core";
import { addSeatSectionAction, deleteSectionAction, updateSeatSectionAction } from "@/lib/actions/venues";

export type DesignerSection = {
  id: string;
  name: string;
  color: string;
  /** Receta con la que se generaron las butacas (null si se cargaron sin editor). */
  layout: SectionShape | null;
  seats: { x: number; y: number }[];
  /** Tiene entradas vendidas o reservadas: no se puede borrar ni cambiar su forma. */
  sold: boolean;
  /** En cuántas funciones tiene precio. */
  priced: number;
};

const fieldClass = "field";

/** Dos butacas a menos de esta distancia se dibujan una encima de la otra. */
const OVERLAP_DISTANCE = 13;

const DEFAULTS = {
  rows: 5,
  seatsPerRow: 10,
  gridX: CANVAS_WIDTH / 2 - 120,
  gridY: 220,
  seatGap: 26,
  rowGap: 26,
  centerX: CANVAS_WIDTH / 2,
  centerY: 40,
  startRadius: 220,
  arcRowGap: 28,
  startAngleDeg: 20,
  spanDeg: 140,
};

function overlapsAny(seats: { x: number; y: number }[], sections: DesignerSection[]) {
  return sections.find((section) =>
    section.seats.some((seat) => seats.some((p) => Math.hypot(p.x - seat.x, p.y - seat.y) < OVERLAP_DISTANCE)),
  );
}

/** Primera posición (de arriba hacia abajo) donde la grilla por defecto no pisa otra sección. */
function freeGridSpot(sections: DesignerSection[]) {
  const base = { type: "grid" as const, rows: DEFAULTS.rows, seatsPerRow: DEFAULTS.seatsPerRow, seatGap: DEFAULTS.seatGap, rowGap: DEFAULTS.rowGap };
  for (let y = 80; y <= CANVAS_HEIGHT - 120; y += 20) {
    for (const x of [DEFAULTS.gridX, 60, CANVAS_WIDTH - 300]) {
      if (!overlapsAny(computeSeatPositions({ ...base, x, y }), sections)) return { x, y };
    }
  }
  return { x: DEFAULTS.gridX, y: DEFAULTS.gridY };
}

export function SeatDesigner({
  venueId,
  existingSections,
  zones = [],
}: {
  venueId: string;
  existingSections: DesignerSection[];
  /** Zonas de entrada general ya dibujadas: se ven de fondo para ubicar las butacas sin pisarlas. */
  zones?: { id: string; name: string; color: string; layout: ZoneShape }[];
}) {
  const [initialSpot] = useState(() => freeGridSpot(existingSections));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shapeType, setShapeType] = useState<"grid" | "arc">("grid");
  const [name, setName] = useState("");
  const [color, setColor] = useState(SECTION_COLORS[0]!);
  const [rows, setRows] = useState(DEFAULTS.rows);
  const [seatsPerRow, setSeatsPerRow] = useState(DEFAULTS.seatsPerRow);

  const [gridX, setGridX] = useState(initialSpot.x);
  const [gridY, setGridY] = useState(initialSpot.y);
  const [seatGap, setSeatGap] = useState(DEFAULTS.seatGap);
  const [rowGap, setRowGap] = useState(DEFAULTS.rowGap);

  const [centerX, setCenterX] = useState(DEFAULTS.centerX);
  const [centerY, setCenterY] = useState(DEFAULTS.centerY);
  const [startRadius, setStartRadius] = useState(DEFAULTS.startRadius);
  const [arcRowGap, setArcRowGap] = useState(DEFAULTS.arcRowGap);
  const [startAngleDeg, setStartAngleDeg] = useState(DEFAULTS.startAngleDeg);
  const [spanDeg, setSpanDeg] = useState(DEFAULTS.spanDeg);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startPx: number; startPy: number; startX: number; startY: number } | null>(null);

  const editing = existingSections.find((s) => s.id === editingId) ?? null;
  // Con ventas, cambiar la forma recrearía butacas ya vendidas: solo nombre y color.
  const shapeLocked = Boolean(editing?.sold);
  const others = existingSections.filter((s) => s.id !== editingId);

  const shape: SectionShape =
    shapeType === "grid"
      ? { type: "grid", rows, seatsPerRow, x: gridX, y: gridY, seatGap, rowGap }
      : { type: "arc", rows, seatsPerRow, centerX, centerY, startRadius, rowGap: arcRowGap, startAngleDeg, spanDeg };

  const previewSeats = computeSeatPositions(shape);
  const xs = previewSeats.map((s) => s.x);
  const ys = previewSeats.map((s) => s.y);
  const minX = Math.min(...xs) - 18;
  const maxX = Math.max(...xs) + 18;
  const minY = Math.min(...ys) - 18;
  const maxY = Math.max(...ys) + 18;

  const overlapping = overlapsAny(previewSeats, others);

  function loadShape(s: SectionShape) {
    setShapeType(s.type);
    setRows(s.rows);
    setSeatsPerRow(s.seatsPerRow);
    if (s.type === "grid") {
      setGridX(s.x);
      setGridY(s.y);
      setSeatGap(s.seatGap);
      setRowGap(s.rowGap);
    } else {
      setCenterX(s.centerX);
      setCenterY(s.centerY);
      setStartRadius(s.startRadius);
      setArcRowGap(s.rowGap);
      setStartAngleDeg(s.startAngleDeg);
      setSpanDeg(s.spanDeg);
    }
  }

  function resetToNew(placeAround: DesignerSection[] = existingSections) {
    const spot = freeGridSpot(placeAround);
    setEditingId(null);
    setName("");
    setColor(SECTION_COLORS[0]!);
    loadShape({
      type: "grid",
      rows: DEFAULTS.rows,
      seatsPerRow: DEFAULTS.seatsPerRow,
      x: spot.x,
      y: spot.y,
      seatGap: DEFAULTS.seatGap,
      rowGap: DEFAULTS.rowGap,
    });
  }

  function startEdit(section: DesignerSection) {
    setError(null);
    setNotice(null);
    if (!section.layout) {
      setError(`"${section.name}" se cargó sin el editor: no se puede editar su forma. Puedes borrarla y dibujarla de nuevo.`);
      return;
    }
    setEditingId(section.id);
    setName(section.name);
    setColor(section.color);
    loadShape(section.layout);
  }

  function handleDelete(section: DesignerSection) {
    setError(null);
    setNotice(null);
    if (section.sold) {
      setError(`"${section.name}" ya tiene entradas vendidas o reservadas: no se puede borrar.`);
      return;
    }
    const extra =
      section.priced > 0
        ? `\n\nTambién se quitará su precio en ${section.priced} ${section.priced === 1 ? "función" : "funciones"}.`
        : "";
    if (!window.confirm(`¿Borrar la sección "${section.name}" y sus ${section.seats.length} butacas?${extra}`)) return;

    const fd = new FormData();
    fd.set("sectionId", section.id);
    startTransition(async () => {
      const result = await deleteSectionAction(undefined, fd);
      if (result?.error) return setError(result.error);
      if (section.id === editingId) resetToNew();
      setNotice(`Sección "${section.name}" borrada.`);
    });
  }

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
    if (shapeLocked) return;
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
    setNotice(null);
    if (!name.trim()) {
      setError("Ponle un nombre a la sección.");
      return;
    }
    const fd = new FormData();
    fd.set("venueId", venueId);
    fd.set("name", name);
    fd.set("color", color);
    fd.set("shape", JSON.stringify(editing && shapeLocked ? editing.layout : shape));
    if (editing) fd.set("sectionId", editing.id);

    startTransition(async () => {
      const result = editing ? await updateSeatSectionAction(undefined, fd) : await addSeatSectionAction(undefined, fd);
      if (result?.error) return setError(result.error);
      setNotice(editing ? `Cambios guardados en "${name}".` : `Sección "${name}" agregada.`);
      const justSaved: DesignerSection = { id: "nueva", name, color, layout: shape, seats: previewSeats, sold: false, priced: 0 };
      resetToNew([...others, justSaved]);
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
          <rect x={CANVAS_WIDTH / 2 - 160} y={16} width={320} height={20} rx={4} fill="#1a1a18" />
          <text x={CANVAS_WIDTH / 2} y={30} textAnchor="middle" fontSize="10" letterSpacing="2" fill="#fff">
            ESCENARIO
          </text>

          {zones.map((z) => {
            const p = zoneLabelPoint(z.layout);
            return (
              <g key={z.id} opacity={0.6} pointerEvents="none">
                <path d={zonePath(z.layout)} fill={z.color} fillOpacity={0.2} stroke={z.color} strokeWidth={1.5} />
                <text x={p.x} y={p.y} textAnchor="middle" fontSize="13" fontWeight="700" fill="#1a1a18">
                  {z.name}
                </text>
              </g>
            );
          })}

          <rect
            x={minX}
            y={minY}
            width={maxX - minX}
            height={maxY - minY}
            rx={12}
            fill={color}
            opacity={0.1}
            stroke={overlapping ? "#b91c1c" : color}
            strokeDasharray="5 4"
            style={{ cursor: shapeLocked ? "not-allowed" : "grab", touchAction: "none" }}
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
          />
          {others.map((s) => (
            <g
              key={s.id}
              onClick={() => startEdit(s)}
              style={{ cursor: "pointer" }}
              opacity={overlapping?.id === s.id ? 0.9 : 0.5}
            >
              <title>{`${s.name} · clic para editar`}</title>
              {s.seats.map((seat, i) => (
                <circle
                  key={i}
                  cx={seat.x}
                  cy={seat.y}
                  r={5}
                  fill={s.color}
                  stroke={overlapping?.id === s.id ? "#b91c1c" : "none"}
                  strokeWidth={1.5}
                />
              ))}
            </g>
          ))}

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
          {editing
            ? `Editando "${editing.name}": arrástrala para moverla. ${previewSeats.length} butacas.`
            : `Arrastra el área punteada para ubicar la sección nueva. ${previewSeats.length} butacas. Haz clic en una sección existente para editarla.`}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {existingSections.length > 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Secciones cargadas
            </h3>
            <ul className="flex flex-col gap-1 text-sm">
              {existingSections.map((s) => (
                <li
                  key={s.id}
                  className={`flex items-center gap-2 rounded px-1 py-1 ${s.id === editingId ? "bg-[var(--accent-soft)]" : ""}`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="font-mono text-xs text-[var(--ink-dim)]">{s.seats.length}</span>
                  <button
                    type="button"
                    onClick={() => startEdit(s)}
                    disabled={pending}
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s)}
                    disabled={pending}
                    title={s.sold ? "Tiene entradas vendidas o reservadas" : undefined}
                    className={`text-xs hover:underline ${s.sold ? "text-[var(--ink-dim)]" : "text-[var(--danger)]"}`}
                  >
                    Borrar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              {editing ? `Editando "${editing.name}"` : "Nueva sección"}
            </h3>
            {editing && (
              <button type="button" onClick={() => resetToNew()} className="text-xs text-[var(--ink-muted)] hover:underline">
                Cancelar
              </button>
            )}
          </div>

          {shapeLocked && (
            <p className="rounded bg-[var(--warn-soft)] px-2 py-1.5 text-xs text-[var(--warn)]">
              Tiene entradas vendidas o reservadas: solo puedes cambiar su nombre y color.
            </p>
          )}

          <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Platea" className={fieldClass} />
          </label>

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
                  style={{ background: c, outline: color === c ? "2px solid var(--ink)" : "none", outlineOffset: 2 }}
                />
              ))}
            </div>
          </div>

          <fieldset disabled={shapeLocked} className="flex flex-col gap-3 disabled:opacity-50">
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
          </fieldset>

          {overlapping && !shapeLocked && (
            <p className="text-xs text-[var(--danger)]">
              Se superpone con &quot;{overlapping.name}&quot;. Muévela o cambia su tamaño.
            </p>
          )}
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          {notice && <p className="text-sm text-[var(--accent)]">{notice}</p>}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending || (Boolean(overlapping) && !shapeLocked)}
            className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Guardando…" : editing ? "Guardar cambios" : "+ Agregar sección al mapa"}
          </button>
        </div>
      </div>
    </div>
  );
}
