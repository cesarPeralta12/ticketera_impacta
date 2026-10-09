"use client";

/**
 * Puertas en el mapa: cada puerta tiene nombre, un lugar en el mapa (donde está la entrada) y las secciones
 * que entran por ella. Se arrastra el marcador para ubicarla. Una puerta sin secciones marcadas acepta todas.
 */
import { useRef, useState, useTransition } from "react";
import { CANVAS_HEIGHT, CANVAS_WIDTH, gateLabelWidth, zoneLabelPoint, zonePath, type ZoneShape } from "@ticketera/core";
import { GateMarkers } from "@/components/map-gates";
import { deleteAccessPointAction, saveAccessPointAction } from "@/lib/actions/venues";

export type DesignerGate = {
  id: string;
  name: string;
  /** null: sin ubicar en el mapa. */
  x: number | null;
  y: number | null;
  sectionIds: string[];
  /** Lecturas registradas: con ellas la puerta no se puede borrar. */
  scans: number;
};

type Props = {
  venueId: string;
  gates: DesignerGate[];
  sections: { id: string; name: string; color: string }[];
  zones: { id: string; name: string; color: string; shape: ZoneShape }[];
  seats: { x: number; y: number; color: string }[];
};

const clamp = (v: number, max: number) => Math.min(Math.max(Math.round(v), 0), max);

export function GateDesigner({ venueId, gates, sections, zones, seats }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [place, setPlace] = useState(true);
  const [pos, setPos] = useState(() => freeSpot(gates));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const editing = gates.find((g) => g.id === editingId) ?? null;
  const placedOthers = gates.filter((g) => g.id !== editingId && g.x !== null && g.y !== null);
  const w = gateLabelWidth(name || "Nueva puerta");

  function reset(nextGates: DesignerGate[] = gates) {
    setEditingId(null);
    setName("");
    setSectionIds([]);
    setPlace(true);
    setPos(freeSpot(nextGates));
  }

  function startEdit(g: DesignerGate) {
    setError(null);
    setNotice(null);
    setEditingId(g.id);
    setName(g.name);
    setSectionIds(g.sectionIds);
    setPlace(g.x !== null && g.y !== null);
    setPos(g.x !== null && g.y !== null ? { x: g.x, y: g.y } : freeSpot(gates.filter((o) => o.id !== g.id)));
  }

  function toSvgPoint(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: ((clientX - rect.left) / rect.width) * CANVAS_WIDTH, y: ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT };
  }

  function dragStart(e: React.PointerEvent<SVGGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toSvgPoint(e.clientX, e.clientY);
    dragRef.current = { px: p.x, py: p.y, x: pos.x, y: pos.y };
  }

  function dragMove(e: React.PointerEvent<SVGGElement>) {
    const start = dragRef.current;
    if (!start) return;
    const p = toSvgPoint(e.clientX, e.clientY);
    setPos({ x: clamp(start.x + p.x - start.px, CANVAS_WIDTH), y: clamp(start.y + p.y - start.py, CANVAS_HEIGHT) });
  }

  function submit() {
    setError(null);
    setNotice(null);
    if (name.trim().length < 2) return setError("Ponle un nombre a la puerta.");
    const fd = new FormData();
    fd.set("name", name.trim());
    if (editing) fd.set("accessPointId", editing.id);
    else fd.set("venueId", venueId);
    if (place) {
      fd.set("mapX", String(pos.x));
      fd.set("mapY", String(pos.y));
    }
    for (const id of sectionIds) fd.append("sectionIds", id);
    startTransition(async () => {
      const result = await saveAccessPointAction(undefined, fd);
      if (result?.error) return setError(result.error);
      if (result?.fieldErrors) return setError(Object.values(result.fieldErrors)[0] ?? "Revisa los datos.");
      setNotice(editing ? `Cambios guardados en "${name}".` : `Puerta "${name}" agregada.`);
      const saved: DesignerGate = { id: editing?.id ?? "nueva", name, x: place ? pos.x : null, y: place ? pos.y : null, sectionIds, scans: editing?.scans ?? 0 };
      reset([...gates.filter((g) => g.id !== editingId), saved]);
    });
  }

  function remove() {
    if (!editing) return;
    if (!window.confirm(`¿Borrar la puerta "${editing.name}"?`)) return;
    const fd = new FormData();
    fd.set("accessPointId", editing.id);
    startTransition(async () => {
      const result = await deleteAccessPointAction(undefined, fd);
      if (result?.error) return setError(result.error);
      setNotice(`Puerta "${editing.name}" borrada.`);
      reset(gates.filter((g) => g.id !== editing.id));
    });
  }

  function toggleSection(id: string) {
    setSectionIds((current) => (current.includes(id) ? current.filter((s) => s !== id) : [...current, id]));
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <svg ref={svgRef} viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} className="w-full touch-none select-none" style={{ background: "#fbfbf9" }}>
          <rect x={CANVAS_WIDTH / 2 - 160} y={16} width={320} height={20} rx={4} fill="#1a1a18" />
          <text x={CANVAS_WIDTH / 2} y={30} textAnchor="middle" fontSize="10" letterSpacing="2" fill="#fff">
            ESCENARIO
          </text>

          {zones.map((z) => {
            const p = zoneLabelPoint(z.shape);
            return (
              <g key={z.id} opacity={0.55} pointerEvents="none">
                <path d={zonePath(z.shape)} fill={z.color} fillOpacity={0.2} stroke={z.color} strokeWidth={1.5} />
                <text x={p.x} y={p.y} textAnchor="middle" fontSize="13" fontWeight="700" fill="#1a1a18">
                  {z.name}
                </text>
              </g>
            );
          })}
          {seats.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={4.5} fill={s.color} opacity={0.45} pointerEvents="none" />
          ))}

          {/* Las demás puertas: clic para editarlas */}
          {placedOthers.map((g) => (
            <g key={g.id} onClick={() => startEdit(g)} style={{ cursor: "pointer" }}>
              <GateMarkers gates={[{ id: g.id, name: g.name, x: g.x!, y: g.y! }]} dim />
              <rect x={g.x! - gateLabelWidth(g.name) / 2} y={g.y! - 13} width={gateLabelWidth(g.name)} height={26} fill="transparent" />
            </g>
          ))}

          {place && (
            <g
              transform={`translate(${pos.x} ${pos.y})`}
              style={{ cursor: "grab", touchAction: "none" }}
              onPointerDown={dragStart}
              onPointerMove={dragMove}
              onPointerUp={() => (dragRef.current = null)}
            >
              <rect x={-w / 2 - 4} y={-17} width={w + 8} height={34} rx={17} fill="#f5b700" fillOpacity={0.3} stroke="#1a1a18" strokeDasharray="5 4" />
              <rect x={-w / 2} y={-13} width={w} height={26} rx={13} fill="#1a1a18" stroke="#35c48f" strokeWidth={2} />
              <circle cx={-w / 2 + 14} cy={0} r={5} fill="#35c48f" />
              <text x={-w / 2 + 25} y={4.5} fontSize="12.5" fontWeight="700" fill="#fff" pointerEvents="none">
                {name || "Nueva puerta"}
              </text>
            </g>
          )}
        </svg>
        <p className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--ink-dim)]">
          {place
            ? "Arrastra la puerta al lugar donde está la entrada. Haz clic en otra puerta para editarla."
            : "Esta puerta no se dibuja en el mapa: se mostrará al borde de abajo, marcada como sin ubicar."}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {gates.length > 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Puertas</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {gates.map((g) => (
                <li key={g.id} className={`flex items-center gap-2 rounded px-1 py-1 ${g.id === editingId ? "bg-[var(--accent-soft)]" : ""}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#35c48f]" />
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                  {g.x === null && <span className="eyebrow">sin ubicar</span>}
                  <span className="text-xs text-[var(--ink-dim)]">{g.sectionIds.length === 0 ? "todas" : `${g.sectionIds.length} secc.`}</span>
                  <button type="button" onClick={() => startEdit(g)} disabled={pending} className="text-xs text-[var(--accent)] hover:underline">
                    Editar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{editing ? `Editando "${editing.name}"` : "Nueva puerta"}</h3>
            {editing && (
              <button type="button" onClick={() => reset()} className="text-xs text-[var(--ink-muted)] hover:underline">
                Cancelar
              </button>
            )}
          </div>

          <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acceso norte, Puerta 1, Acceso VIP…" maxLength={40} className="field" />
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs text-[var(--ink-muted)]">Secciones que entran por esta puerta</legend>
            {sections.length === 0 ? (
              <p className="text-xs text-[var(--ink-dim)]">El recinto todavía no tiene secciones.</p>
            ) : (
              sections.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={sectionIds.includes(s.id)} onChange={() => toggleSection(s.id)} className="accent-[var(--accent)]" />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </label>
              ))
            )}
            <p className="text-xs text-[var(--ink-dim)]">
              {sectionIds.length === 0
                ? "Ninguna marcada: la puerta acepta todas las secciones."
                : "Solo esas secciones entran por aquí: sin internet, dos puertas nunca aceptan la misma entrada."}
            </p>
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Dibujar en el mapa
          </label>
          {place && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                Izquierda (X)
                <input type="number" min={0} max={CANVAS_WIDTH} value={pos.x} onChange={(e) => setPos((p) => ({ ...p, x: clamp(Number(e.target.value), CANVAS_WIDTH) }))} className="field" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                Arriba (Y)
                <input type="number" min={0} max={CANVAS_HEIGHT} value={pos.y} onChange={(e) => setPos((p) => ({ ...p, y: clamp(Number(e.target.value), CANVAS_HEIGHT) }))} className="field" />
              </label>
            </div>
          )}

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          {notice && <p className="text-sm text-[var(--accent)]">{notice}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Guardando…" : editing ? "Guardar cambios" : "+ Agregar puerta al mapa"}
          </button>
          {editing && editing.scans === 0 && (
            <button type="button" onClick={remove} disabled={pending} className="text-xs text-[var(--danger)] hover:underline">
              Borrar puerta
            </button>
          )}
          {editing && editing.scans > 0 && <p className="text-xs text-[var(--ink-dim)]">Ya registró lecturas: no se puede borrar.</p>}
        </div>
      </div>
    </div>
  );
}

/** Lugar libre en el borde de abajo para una puerta nueva (la primera sin otra puerta cerca). */
function freeSpot(gates: DesignerGate[]) {
  const placed = gates.flatMap((g) => (g.x !== null && g.y !== null ? [{ x: g.x, y: g.y }] : []));
  for (let x = 500; x < CANVAS_WIDTH - 60; x += 160) {
    for (const sx of [x, CANVAS_WIDTH - x]) {
      if (!placed.some((p) => Math.abs(p.x - sx) < 150 && Math.abs(p.y - (CANVAS_HEIGHT - 28)) < 30)) return { x: sx, y: CANVAS_HEIGHT - 28 };
    }
  }
  return { x: 500, y: CANVAS_HEIGHT - 28 };
}
