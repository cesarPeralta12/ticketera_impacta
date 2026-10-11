"use client";

/**
 * Editor de zonas de entrada general (sin butacas): se dibujan como una forma en el mismo mapa que las butacas
 * (rectángulo, óvalo, trapecio o arco), con su nombre y su aforo. Se arrastra para ubicarla y se ajusta con
 * medidas. Las demás secciones se ven de fondo para no pisarlas.
 */
import { useRef, useState, useTransition } from "react";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  SECTION_COLORS,
  ZONE_SHAPE_LABEL,
  defaultZone,
  parseZoneLayout,
  zoneBounds,
  zoneLabelPoint,
  zonePath,
  zonesOverlap,
  type ZoneShape,
  type ZoneShapeName,
} from "@ticketera/core";
import { addGeneralSectionAction, updateGeneralSectionAction } from "@/lib/actions/venues";

export type DesignerZone = {
  id: string;
  name: string;
  color: string;
  capacity: number;
  /** null: se cargó sin forma (solo estaba en la lista). */
  layout: ZoneShape | null;
};

type Props = {
  venueId: string;
  zones: DesignerZone[];
  /** Butacas de las secciones numeradas, de fondo, para ubicar la zona sin pisarlas. */
  seats: { x: number; y: number; color: string }[];
};

const SHAPES: ZoneShapeName[] = ["rect", "ellipse", "trapezoid", "arc"];

/** Primer lugar libre (de arriba hacia abajo) donde cabe una zona por defecto sin pisar otras ni butacas. */
function freeSpot(zones: DesignerZone[], seats: Props["seats"]) {
  const others = zones.flatMap((z) => (z.layout ? [z.layout] : []));
  for (let y = 300; y <= CANVAS_HEIGHT - 170; y += 20) {
    for (const x of [300, 40, CANVAS_WIDTH - 440]) {
      const candidate = defaultZone("rect", { x, y });
      const b = zoneBounds(candidate);
      const hitsSeat = seats.some((s) => s.x > b.minX - 8 && s.x < b.maxX + 8 && s.y > b.minY - 8 && s.y < b.maxY + 8);
      if (!hitsSeat && !others.some((o) => zonesOverlap(candidate, o))) return { x, y };
    }
  }
  return { x: 300, y: 380 };
}

const num = (v: string) => (v === "" ? Number.NaN : Number(v));

export function ZoneDesigner({ venueId, zones, seats }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(200);
  const [color, setColor] = useState(SECTION_COLORS[0]!);
  const [draw, setDraw] = useState(true);
  const [zone, setZone] = useState<ZoneShape>(() => defaultZone("rect", freeSpot(zones, seats)));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ px: number; py: number; zone: ZoneShape } | null>(null);

  const editing = zones.find((z) => z.id === editingId) ?? null;
  const others = zones.filter((z) => z.id !== editingId && z.layout);
  const check = parseZoneLayout(zone);
  const overlapping = check.ok ? others.find((z) => zonesOverlap(zone, z.layout!)) : undefined;
  const seatsInside = check.ok
    ? (() => {
        const b = zoneBounds(zone);
        return seats.filter((s) => s.x > b.minX && s.x < b.maxX && s.y > b.minY && s.y < b.maxY).length;
      })()
    : 0;

  function reset(nextZones: DesignerZone[] = zones) {
    setEditingId(null);
    setName("");
    setCapacity(200);
    setColor(SECTION_COLORS[0]!);
    setDraw(true);
    setZone(defaultZone("rect", freeSpot(nextZones, seats)));
  }

  function startEdit(z: DesignerZone) {
    setError(null);
    setNotice(null);
    setEditingId(z.id);
    setName(z.name);
    setColor(z.color);
    setCapacity(z.capacity);
    setDraw(true);
    setZone(z.layout ?? defaultZone("rect", freeSpot(zones.filter((o) => o.id !== z.id), seats)));
  }

  function changeShape(shape: ZoneShapeName) {
    if (shape === zone.shape) return;
    // Al cambiar de forma se conserva el lugar donde estaba.
    const b = zoneBounds(zone);
    setZone(shape === "arc" ? defaultZone("arc") : defaultZone(shape, { x: Math.round(b.minX), y: Math.round(b.minY) }));
  }

  function patch(values: Record<string, number>) {
    setZone((z) => ({ ...z, ...values }) as ZoneShape);
  }

  function toSvgPoint(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: ((clientX - rect.left) / rect.width) * CANVAS_WIDTH, y: ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT };
  }

  function dragStart(e: React.PointerEvent<SVGPathElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toSvgPoint(e.clientX, e.clientY);
    dragRef.current = { px: p.x, py: p.y, zone };
  }

  function dragMove(e: React.PointerEvent<SVGPathElement>) {
    const start = dragRef.current;
    if (!start) return;
    const p = toSvgPoint(e.clientX, e.clientY);
    const dx = Math.round(p.x - start.px);
    const dy = Math.round(p.y - start.py);
    const z = start.zone;
    setZone(z.shape === "arc" ? { ...z, centerX: z.centerX + dx, centerY: z.centerY + dy } : { ...z, x: z.x + dx, y: z.y + dy });
  }

  function submit() {
    setError(null);
    setNotice(null);
    if (name.trim().length < 2) return setError("Ponle un nombre a la zona.");
    if (!editing && (!Number.isInteger(capacity) || capacity < 1)) return setError("Ingresa el aforo (cuántas personas entran).");
    if (draw && !check.ok) return setError(check.error);

    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("color", color);
    if (draw && check.ok) fd.set("zone", JSON.stringify(check.zone));
    if (editing) fd.set("sectionId", editing.id);
    else {
      fd.set("venueId", venueId);
      fd.set("capacity", String(capacity));
    }
    startTransition(async () => {
      const result = editing ? await updateGeneralSectionAction(undefined, fd) : await addGeneralSectionAction(undefined, fd);
      if (result?.error) return setError(result.error);
      if (result?.fieldErrors) return setError(Object.values(result.fieldErrors)[0] ?? "Revisa los datos.");
      setNotice(editing ? `Cambios guardados en "${name}".` : `Zona "${name}" agregada.`);
      const saved: DesignerZone = { id: "nueva", name, color, capacity, layout: draw && check.ok ? check.zone : null };
      reset([...zones.filter((z) => z.id !== editingId), saved]);
    });
  }

  const label = check.ok ? zoneLabelPoint(zone) : { x: 0, y: 0 };
  const fieldClass = "field";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <svg ref={svgRef} viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} className="w-full touch-none select-none" style={{ background: "#fbfbf9" }}>
          <rect x={CANVAS_WIDTH / 2 - 160} y={16} width={320} height={20} rx={4} fill="#1a1a18" />
          <text x={CANVAS_WIDTH / 2} y={30} textAnchor="middle" fontSize="10" letterSpacing="2" fill="#fff">
            ESCENARIO
          </text>

          {seats.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={4.5} fill={s.color} opacity={0.45} />
          ))}

          {others.map((z) => {
            const p = zoneLabelPoint(z.layout!);
            return (
              <g key={z.id} onClick={() => startEdit(z)} style={{ cursor: "pointer" }} opacity={overlapping?.id === z.id ? 1 : 0.7}>
                <title>{`${z.name} · aforo ${z.capacity} · clic para editar`}</title>
                <path d={zonePath(z.layout!)} fill={z.color} fillOpacity={0.3} stroke={overlapping?.id === z.id ? "#b91c1c" : z.color} strokeWidth={2} />
                <text x={p.x} y={p.y} textAnchor="middle" fontSize="15" fontWeight="700" fill="#1a1a18">
                  {z.name}
                </text>
                <text x={p.x} y={p.y + 18} textAnchor="middle" fontSize="12" fill="#3f3f3a">
                  {z.capacity} pers.
                </text>
              </g>
            );
          })}

          {draw && check.ok && (
            <g>
              <path
                d={zonePath(zone)}
                fill={color}
                fillOpacity={0.35}
                stroke={overlapping ? "#b91c1c" : "#1a1a18"}
                strokeWidth={2}
                strokeDasharray="6 4"
                style={{ cursor: "grab", touchAction: "none" }}
                onPointerDown={dragStart}
                onPointerMove={dragMove}
                onPointerUp={() => (dragRef.current = null)}
              />
              <text x={label.x} y={label.y} textAnchor="middle" fontSize="16" fontWeight="700" fill="#1a1a18" pointerEvents="none">
                {name || "Nueva zona"}
              </text>
              <text x={label.x} y={label.y + 19} textAnchor="middle" fontSize="12" fill="#3f3f3a" pointerEvents="none">
                {editing ? `${editing.capacity} pers.` : `${Number.isFinite(capacity) ? capacity : "?"} pers.`}
              </text>
            </g>
          )}
        </svg>
        <p className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--ink-dim)]">
          {draw
            ? "Arrastra la forma punteada para ubicarla y ajusta su tamaño con las medidas. Haz clic en otra zona para editarla."
            : "Esta zona no se dibuja en el mapa: solo aparecerá en la lista de entradas."}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {zones.length > 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Zonas generales</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {zones.map((z) => (
                <li key={z.id} className={`flex items-center gap-2 rounded px-1 py-1 ${z.id === editingId ? "bg-[var(--accent-soft)]" : ""}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: z.color }} />
                  <span className="min-w-0 flex-1 truncate">{z.name}</span>
                  <span className="font-mono text-xs text-[var(--ink-dim)]">{z.capacity}</span>
                  {!z.layout && <span className="eyebrow">sin forma</span>}
                  <button type="button" onClick={() => startEdit(z)} disabled={pending} className="text-xs text-[var(--accent)] hover:underline">
                    {z.layout ? "Editar" : "Colocar en el mapa"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{editing ? `Editando "${editing.name}"` : "Nueva zona general"}</h3>
            {editing && (
              <button type="button" onClick={() => reset()} className="text-xs text-[var(--ink-muted)] hover:underline">
                Cancelar
              </button>
            )}
          </div>

          <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cancha, Campo, VIP…" className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
            Aforo (personas)
            <input
              type="number"
              min={1}
              value={editing ? editing.capacity : Number.isFinite(capacity) ? capacity : ""}
              onChange={(e) => setCapacity(num(e.target.value))}
              disabled={Boolean(editing)}
              className={fieldClass}
            />
            {editing && <span className="text-[10px]">El aforo no se cambia aquí: las entradas ya emitidas dependen de él.</span>}
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

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draw} onChange={(e) => setDraw(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Dibujar en el mapa
          </label>

          {draw && (
            <fieldset className="flex flex-col gap-3">
              <div className="grid grid-cols-4 gap-1 rounded-md bg-[var(--surface-2)] p-1 text-xs">
                {SHAPES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => changeShape(s)}
                    className={`rounded px-1 py-1.5 transition-colors ${zone.shape === s ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--ink-muted)]"}`}
                  >
                    {ZONE_SHAPE_LABEL[s]}
                  </button>
                ))}
              </div>

              {zone.shape === "arc" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Measure label="Centro X" value={zone.centerX} onChange={(v) => patch({ centerX: v })} />
                  <Measure label="Centro Y" value={zone.centerY} onChange={(v) => patch({ centerY: v })} />
                  <Measure label="Radio interior" value={zone.innerRadius} onChange={(v) => patch({ innerRadius: v })} />
                  <Measure label="Radio exterior" value={zone.outerRadius} onChange={(v) => patch({ outerRadius: v })} />
                  <Measure label="Ángulo inicial" value={zone.startAngleDeg} onChange={(v) => patch({ startAngleDeg: v })} />
                  <Measure label="Apertura (°)" value={zone.spanDeg} onChange={(v) => patch({ spanDeg: v })} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Measure label="Izquierda (X)" value={zone.x} onChange={(v) => patch({ x: v })} />
                  <Measure label="Arriba (Y)" value={zone.y} onChange={(v) => patch({ y: v })} />
                  <Measure label="Ancho" value={zone.width} onChange={(v) => patch({ width: v })} />
                  <Measure label="Alto" value={zone.height} onChange={(v) => patch({ height: v })} />
                  {zone.shape === "trapezoid" && (
                    <label className="col-span-2 flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                      Qué tan angosto es arriba ({Math.round((zone.taper ?? 0.3) * 100)}%)
                      <input type="range" min={0} max={80} value={Math.round((zone.taper ?? 0.3) * 100)} onChange={(e) => patch({ taper: Number(e.target.value) / 100 })} />
                    </label>
                  )}
                </div>
              )}
            </fieldset>
          )}

          {draw && !check.ok && <p className="text-xs text-[var(--danger)]">{check.error}</p>}
          {draw && overlapping && <p className="text-xs text-[var(--danger)]">Se superpone con &quot;{overlapping.name}&quot;. Muévela o cambia su tamaño.</p>}
          {draw && seatsInside > 0 && <p className="text-xs text-[var(--warn)]">Tapa {seatsInside} butaca(s) del mapa: muévela para que no se pisen.</p>}
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          {notice && <p className="text-sm text-[var(--accent)]">{notice}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={pending || (draw && !check.ok)}
            className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Guardando…" : editing ? "Guardar cambios" : "+ Agregar zona al mapa"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Measure({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
      {label}
      <input type="number" value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(num(e.target.value))} className="field" />
    </label>
  );
}
