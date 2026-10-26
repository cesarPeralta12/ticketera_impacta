"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_CHAIRS,
  MIN_CHAIRS,
  TABLE_SALE_MODE_LABEL,
  parseSeatedTablesLayout,
  seatedTableSeats,
  seatedTablesGrid,
  tableHeight,
  type MapItem,
  type SeatedTable,
  type SeatedTablesLayout,
  type TableSaleMode,
  type TableShape,
} from "@ticketera/core";
import { ActionForm } from "@/components/action-form";
import { MapDecor } from "@/components/map-decor";
import { PlanBackground, type PlanBackgroundInfo } from "@/components/plan-background";
import { addSeatedTablesSectionAction, moveSeatedTablesAction } from "@/lib/actions/venues";

type Background = { x: number; y: number; color: string; sectionId?: string };
/** Una sección de mesas ya creada: se pueden recolocar sus mesas (no cambiar cuántas ni sus sillas). */
export type ExistingTablesSection = { id: string; name: string; color: string; layout: SeatedTablesLayout };
type Point = { x: number; y: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Mesas con sillas alrededor (cena show, gala, matrimonio): se arman en una grilla y se ve en vivo cómo quedan sobre
 * el mapa del recinto; después cada mesa se arrastra a donde va. Cada silla es una butaca; la mesa se vende completa,
 * por silla o de N a M sillas. Las secciones ya creadas se eligen arriba para recolocar sus mesas.
 */
export function SeatedTablesDesigner({
  venueId,
  background,
  plan,
  items = [],
  existing = [],
}: {
  venueId: string;
  background: Background[];
  plan?: PlanBackgroundInfo;
  items?: MapItem[];
  existing?: ExistingTablesSection[];
}) {
  const [editingId, setEditingId] = useState<string>("");
  const editing = existing.find((s) => s.id === editingId);
  return (
    <div className="card space-y-4 p-6">
      {existing.length > 0 && (
        <label className="label w-fit">
          Qué quieres hacer
          <select value={editingId} onChange={(e) => setEditingId(e.target.value)} className="field min-w-72">
            <option value="">Crear mesas nuevas</option>
            {existing.map((s) => (
              <option key={s.id} value={s.id}>
                Mover las mesas de &ldquo;{s.name}&rdquo;
              </option>
            ))}
          </select>
        </label>
      )}
      {editing ? (
        <MoveTables key={editing.id} section={editing} background={background} plan={plan} items={items} onDone={() => setEditingId("")} />
      ) : (
        <NewTables venueId={venueId} background={background} plan={plan} items={items} />
      )}
    </div>
  );
}

/** Lienzo con las mesas y sus sillas: cada mesa se arrastra con el mouse o el dedo (`onMove` recibe su nuevo centro). */
function TablesCanvas({
  layout,
  color,
  background,
  plan,
  items,
  onMove,
}: {
  layout: Omit<SeatedTablesLayout, "type">;
  color: string;
  background: Background[];
  plan?: PlanBackgroundInfo;
  items: MapItem[];
  onMove: (number: number, at: Point) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ number: number; dx: number; dy: number } | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const parsed = parseSeatedTablesLayout({ type: "seated", ...layout });
  const chairs = parsed.ok ? seatedTableSeats(parsed.layout) : [];
  const { size, shape } = layout;

  function point(e: PointerEvent): Point {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }
  function startDrag(e: PointerEvent, table: SeatedTable) {
    const p = point(e);
    drag.current = { number: table.number, dx: table.x - p.x, dy: table.y - p.y };
    setActive(table.number);
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function moveDrag(e: PointerEvent) {
    if (!drag.current) return;
    const p = point(e);
    onMove(drag.current.number, {
      x: Math.round(clamp(p.x + drag.current.dx, 20, CANVAS_WIDTH - 20)),
      y: Math.round(clamp(p.y + drag.current.dy, 20, CANVAS_HEIGHT - 20)),
    });
  }
  function endDrag() {
    drag.current = null;
    setActive(null);
  }

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        className="w-full touch-none select-none rounded-lg border border-[var(--border)]"
        style={{ background: "#fbfbf9" }}
        role="application"
        aria-label="Mesas: arrastra cada una a su lugar"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <PlanBackground background={plan} />
        <MapDecor items={items} />
        {background.map((b, i) => (
          <circle key={i} cx={b.x} cy={b.y} r={4} fill={b.color} opacity={0.25} pointerEvents="none" />
        ))}
        {layout.tables.map((t) => {
          const moving = active === t.number;
          return (
            <g key={t.number} className="cursor-move" onPointerDown={(e) => startDrag(e, t)}>
              {shape === "round" ? (
                <circle cx={t.x} cy={t.y} r={size} fill={color} fillOpacity={moving ? 0.45 : 0.25} stroke={moving ? "#1a1a18" : color} strokeWidth={moving ? 3 : 2} />
              ) : (
                <rect
                  x={t.x - size}
                  y={t.y - tableHeight(size) / 2}
                  width={size * 2}
                  height={tableHeight(size)}
                  rx={4}
                  fill={color}
                  fillOpacity={moving ? 0.45 : 0.25}
                  stroke={moving ? "#1a1a18" : color}
                  strokeWidth={moving ? 3 : 2}
                />
              )}
              <text x={t.x} y={t.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a1a18" pointerEvents="none">
                {t.number}
              </text>
            </g>
          );
        })}
        {chairs.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={6} fill="#fff" stroke={color} strokeWidth={2} pointerEvents="none" />
        ))}
      </svg>
      <p className="text-xs text-[var(--ink-dim)]">Arrastra cada mesa a donde va (con el mouse o el dedo); sus sillas la siguen.</p>
      {!parsed.ok && <p className="text-sm text-[var(--danger)]">{parsed.error}</p>}
    </>
  );
}

/** Crear una sección nueva: se arma la grilla y después se acomoda cada mesa arrastrándola. */
function NewTables({ venueId, background, plan, items }: { venueId: string; background: Background[]; plan?: PlanBackgroundInfo; items: MapItem[] }) {
  const [name, setName] = useState("Mesas");
  const [color, setColor] = useState("#B98CFF");
  const [prefix, setPrefix] = useState("Mesa");
  const [shape, setShape] = useState<TableShape>("round");
  const [chairs, setChairs] = useState(6);
  const [mode, setMode] = useState<TableSaleMode>("WHOLE");
  const [min, setMin] = useState(2);
  const [max, setMax] = useState(6);
  const [count, setCount] = useState(8);
  const [perRow, setPerRow] = useState(4);
  const [x, setX] = useState(180);
  const [y, setY] = useState(170);
  const [gapX, setGapX] = useState(150);
  const [gapY, setGapY] = useState(140);
  // Mesas que se arrastraron a mano (por número): pisan su lugar en la grilla.
  const [moved, setMoved] = useState<Record<number, Point>>({});
  const size = shape === "round" ? 22 : 30;

  const draft = useMemo(
    () => ({
      type: "seated" as const,
      prefix,
      shape,
      chairs,
      mode,
      min,
      max,
      size,
      tables: seatedTablesGrid({ count, perRow: Math.max(1, perRow), x, y, gapX, gapY }).map((t) => ({ ...t, ...moved[t.number] })),
    }),
    [prefix, shape, chairs, mode, min, max, size, count, perRow, x, y, gapX, gapY, moved],
  );
  const parsed = parseSeatedTablesLayout(draft);
  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value));

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="label">
          Nombre de la sección
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="field" />
        </label>
        <label className="label">
          Cada mesa se llama
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={20} className="field" />
        </label>
        <label className="label">
          Forma
          <select value={shape} onChange={(e) => setShape(e.target.value as TableShape)} className="field">
            <option value="round">Redonda</option>
            <option value="rect">Rectangular</option>
          </select>
        </label>
        <label className="label">
          Sillas por mesa
          <input type="number" min={MIN_CHAIRS} max={MAX_CHAIRS} value={chairs} onChange={num(setChairs)} className="field" />
        </label>
        <label className="label">
          Se vende
          <select value={mode} onChange={(e) => setMode(e.target.value as TableSaleMode)} className="field">
            {(Object.keys(TABLE_SALE_MODE_LABEL) as TableSaleMode[]).map((m) => (
              <option key={m} value={m}>
                {TABLE_SALE_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Color
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-[38px] w-full cursor-pointer rounded border border-[var(--border)]" />
        </label>
        {mode === "RANGE" && (
          <>
            <label className="label">
              Mínimo de sillas (N)
              <input type="number" min={1} max={chairs} value={min} onChange={num(setMin)} className="field" />
            </label>
            <label className="label">
              Máximo de sillas (M)
              <input type="number" min={1} max={chairs} value={max} onChange={num(setMax)} className="field" />
            </label>
          </>
        )}
        <label className="label">
          Cantidad de mesas
          <input type="number" min={1} max={120} value={count} onChange={num(setCount)} className="field" />
        </label>
        <label className="label">
          Mesas por fila
          <input type="number" min={1} max={20} value={perRow} onChange={num(setPerRow)} className="field" />
        </label>
        <label className="label">
          Separación (ancho · alto)
          <span className="flex gap-1">
            <input type="number" min={40} max={400} value={gapX} onChange={num(setGapX)} className="field" aria-label="Separación a lo ancho" />
            <input type="number" min={40} max={400} value={gapY} onChange={num(setGapY)} className="field" aria-label="Separación a lo alto" />
          </span>
        </label>
        <label className="label">
          Desde (x · y)
          <span className="flex gap-1">
            <input type="number" min={0} max={CANVAS_WIDTH} value={x} onChange={num(setX)} className="field" aria-label="Posición x de la primera mesa" />
            <input type="number" min={0} max={CANVAS_HEIGHT} value={y} onChange={num(setY)} className="field" aria-label="Posición y de la primera mesa" />
          </span>
        </label>
      </div>
      <p className="text-xs text-[var(--ink-dim)]">
        {mode === "WHOLE" && `Mesa completa: el comprador elige una mesa y se lleva sus ${chairs} sillas (el precio que cargues es por silla).`}
        {mode === "SEAT" && "Por silla: el comprador elige sillas sueltas, como butacas."}
        {mode === "RANGE" && `De N a M: por compra, entre ${min} y ${max} sillas de cada mesa que elija.`} Cada persona recibe su QR.
      </p>

      <TablesCanvas layout={draft} color={color} background={background} plan={plan} items={items} onMove={(number, at) => setMoved((m) => ({ ...m, [number]: at }))} />

      <div className="flex flex-wrap items-center gap-3">
        <ActionForm action={addSeatedTablesSectionAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="venueId" value={venueId} />
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="color" value={color} />
          <input type="hidden" name="layout" value={JSON.stringify(draft)} />
          <button type="submit" disabled={!parsed.ok} className="btn btn-dark disabled:cursor-not-allowed disabled:opacity-50">
            Crear {count} mesas ({count * chairs} sillas)
          </button>
        </ActionForm>
        {Object.keys(moved).length > 0 && (
          <button type="button" onClick={() => setMoved({})} className="btn text-sm">
            Volver a acomodar en grilla
          </button>
        )}
      </div>
    </>
  );
}

/** Recolocar las mesas de una sección ya creada (con o sin ventas): solo cambia dónde está cada una. */
function MoveTables({
  section,
  background,
  plan,
  items,
  onDone,
}: {
  section: ExistingTablesSection;
  background: Background[];
  plan?: PlanBackgroundInfo;
  items: MapItem[];
  onDone: () => void;
}) {
  const [tables, setTables] = useState<SeatedTable[]>(section.layout.tables);
  const layout = { ...section.layout, tables };
  const parsed = parseSeatedTablesLayout(layout);
  const changed = tables.some((t, i) => t.x !== section.layout.tables[i]?.x || t.y !== section.layout.tables[i]?.y);
  // Sin las sillas de esta sección en el fondo (se dibujan arriba, siguiendo a sus mesas).
  const others = background.filter((b) => b.sectionId !== section.id);

  return (
    <>
      <p className="text-sm text-[var(--ink-muted)]">
        {section.layout.tables.length} mesas de {section.layout.chairs} sillas ({TABLE_SALE_MODE_LABEL[section.layout.mode].toLowerCase()}). Mover
        no cambia las mesas, sus números ni lo vendido: solo dónde se ven en el mapa.
      </p>
      <TablesCanvas
        layout={layout}
        color={section.color}
        background={others}
        plan={plan}
        items={items}
        onMove={(number, at) => setTables((ts) => ts.map((t) => (t.number === number ? { ...t, ...at } : t)))}
      />
      <div className="flex flex-wrap items-center gap-3">
        <ActionForm action={moveSeatedTablesAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="sectionId" value={section.id} />
          <input type="hidden" name="tables" value={JSON.stringify(tables)} />
          <button type="submit" disabled={!parsed.ok || !changed} className="btn btn-dark disabled:cursor-not-allowed disabled:opacity-50">
            Guardar posiciones
          </button>
        </ActionForm>
        <button type="button" onClick={() => setTables(section.layout.tables)} disabled={!changed} className="btn text-sm disabled:opacity-50">
          Deshacer cambios
        </button>
        <button type="button" onClick={onDone} className="text-sm text-[var(--ink-muted)] hover:underline">
          Volver a crear mesas
        </button>
      </div>
    </>
  );
}
