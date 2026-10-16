"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type PointerEvent } from "react";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAP_ITEM_COLOR,
  MAP_ITEM_KINDS,
  MAP_ITEM_LABEL,
  MIN_ITEM_SIZE,
  SECTION_COLORS,
  TABLE_RADIUS,
  defaultMapItem,
  hasStage,
  nextTableNumber,
  zoneLabelPoint,
  zonePath,
  type MapItem,
  type MapItemKind,
  type ZoneShape,
} from "@ticketera/core";
import { deleteSectionAction, saveClubPlanAction } from "@/lib/actions/venues";

export type DesignerTableGroup = {
  sectionId: string;
  name: string;
  color: string;
  prefix: string;
  tables: { id: string; number: number; x: number; y: number; sold: boolean }[];
};

type TableState = { key: string; id?: string; number: number; x: number; y: number; sold: boolean };
type GroupState = { key: string; sectionId?: string; name: string; color: string; prefix: string; tables: TableState[] };
type Selection = { type: "item"; id: string } | { type: "table"; group: string; key: string } | null;
type Drag = { kind: "item" | "resize" | "table"; group?: string; key: string; startX: number; startY: number; origin: { x: number; y: number; w?: number; h?: number } };

let counter = 0;
const newKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

type DesignerProps = {
  venueId: string;
  items: MapItem[];
  groups: DesignerTableGroup[];
  /** Zonas de pie del recinto (de fondo). */
  zones: { id: string; name: string; color: string; layout: ZoneShape }[];
  /** Butacas de otras secciones numeradas (de fondo). */
  seats: { x: number; y: number; color: string }[];
};
type Notice = { ok: boolean; text: string } | null;

/**
 * Plano del boliche: escenario, barras, DJ, entrada, baños y textos (no se venden) y lounges como círculos,
 * puestos uno por uno donde están en el local. Cada grupo de lounges es una sección numerada: el comprador
 * elige su lounge en el mapa. Las zonas de pie (pista) se dibujan con el editor de zonas y aquí se ven de fondo.
 *
 * `version` cambia cuando se guarda: el editor se arma de nuevo con lo guardado (ids nuevos), pero el aviso
 * ("Plano guardado…") vive afuera para que no se pierda.
 */
export function ClubMapDesigner({ version, ...props }: DesignerProps & { version: string }) {
  const [message, setMessage] = useState<Notice>(null);
  return <PlanEditor key={version} {...props} message={message} setMessage={setMessage} />;
}

function PlanEditor({
  venueId,
  items: initialItems,
  groups: initialGroups,
  zones,
  seats,
  message,
  setMessage,
}: DesignerProps & { message: Notice; setMessage: (notice: Notice) => void }) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [items, setItems] = useState<MapItem[]>(initialItems);
  const [groups, setGroups] = useState<GroupState[]>(() =>
    initialGroups.map((g) => ({
      key: g.sectionId,
      sectionId: g.sectionId,
      name: g.name,
      color: g.color,
      prefix: g.prefix,
      tables: g.tables.map((t) => ({ key: t.id, id: t.id, number: t.number, x: t.x, y: t.y, sold: t.sold })),
    })),
  );
  const [selected, setSelected] = useState<Selection>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  const changed = () => {
    setDirty(true);
    setMessage(null);
  };

  function point(event: PointerEvent): { x: number; y: number } {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    const r = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: r.x, y: r.y };
  }

  function startDrag(event: PointerEvent, next: Drag) {
    event.stopPropagation();
    // Captura el puntero para seguir arrastrando aunque salga del elemento (si el navegador lo permite).
    try {
      svgRef.current?.setPointerCapture(event.pointerId);
    } catch {
      /* sin captura igual se arrastra mientras el puntero esté sobre el plano */
    }
    drag.current = next;
  }

  function onMove(event: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = point(event);
    const dx = p.x - d.startX;
    const dy = p.y - d.startY;
    if (d.kind === "table") {
      setGroups((gs) =>
        gs.map((g) =>
          g.key !== d.group
            ? g
            : {
                ...g,
                tables: g.tables.map((t) =>
                  t.key !== d.key
                    ? t
                    : { ...t, x: clamp(d.origin.x + dx, TABLE_RADIUS, CANVAS_WIDTH - TABLE_RADIUS), y: clamp(d.origin.y + dy, TABLE_RADIUS, CANVAS_HEIGHT - TABLE_RADIUS) },
                ),
              },
        ),
      );
    } else {
      setItems((its) =>
        its.map((i) => {
          if (i.id !== d.key) return i;
          if (d.kind === "resize") {
            const width = clamp(d.origin.w! + dx, MIN_ITEM_SIZE, CANVAS_WIDTH - i.x);
            const height = clamp(d.origin.h! + dy, MIN_ITEM_SIZE, CANVAS_HEIGHT - i.y);
            return { ...i, width: Math.round(width), height: Math.round(height) };
          }
          return { ...i, x: Math.round(clamp(d.origin.x + dx, 0, CANVAS_WIDTH - i.width)), y: Math.round(clamp(d.origin.y + dy, 0, CANVAS_HEIGHT - i.height)) };
        }),
      );
    }
    changed();
  }

  function onUp(event: PointerEvent) {
    if (drag.current && svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    drag.current = null;
  }

  /** Clic en el fondo: con un grupo en "poner lounges", agrega uno ahí; si no, quita la selección. */
  function onCanvasDown(event: PointerEvent) {
    if (!placing) {
      setSelected(null);
      return;
    }
    const p = point(event);
    const group = groups.find((g) => g.key === placing);
    if (!group) return;
    const all = groups.flatMap((g) => g.tables);
    if (all.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < TABLE_RADIUS * 2)) {
      setMessage({ ok: false, text: "Ahí ya hay un lounge: toca un lugar libre." });
      return;
    }
    const table: TableState = {
      key: newKey("t"),
      number: nextTableNumber(group.tables),
      x: Math.round(clamp(p.x, TABLE_RADIUS, CANVAS_WIDTH - TABLE_RADIUS)),
      y: Math.round(clamp(p.y, TABLE_RADIUS, CANVAS_HEIGHT - TABLE_RADIUS)),
      sold: false,
    };
    setGroups((gs) => gs.map((g) => (g.key === placing ? { ...g, tables: [...g.tables, table] } : g)));
    setSelected({ type: "table", group: placing, key: table.key });
    changed();
  }

  function addItem(kind: MapItemKind) {
    const at = kind === "STAGE" ? { x: CANVAS_WIDTH / 2, y: 50 } : { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    const item = defaultMapItem(kind, at, newKey("i"));
    setItems((its) => [...its, item]);
    setSelected({ type: "item", id: item.id });
    setPlacing(null);
    changed();
  }

  function updateItem(id: string, patch: Partial<MapItem>) {
    setItems((its) => its.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    changed();
  }

  function removeSelected() {
    if (!selected) return;
    if (selected.type === "item") setItems((its) => its.filter((i) => i.id !== selected.id));
    else {
      const table = groups.find((g) => g.key === selected.group)?.tables.find((t) => t.key === selected.key);
      if (table?.sold) {
        setMessage({ ok: false, text: "Ese lounge ya tiene ventas: se puede mover, pero no quitar." });
        return;
      }
      setGroups((gs) => gs.map((g) => (g.key === selected.group ? { ...g, tables: g.tables.filter((t) => t.key !== selected.key) } : g)));
    }
    setSelected(null);
    changed();
  }

  function addGroup() {
    const n = groups.length + 1;
    const group: GroupState = {
      key: newKey("g"),
      name: n === 1 ? "Lounges VIP" : `Lounges ${n}`,
      color: SECTION_COLORS[(n + 3) % SECTION_COLORS.length]!,
      prefix: "Lounge",
      tables: [],
    };
    setGroups((gs) => [...gs, group]);
    setPlacing(group.key);
    setSelected(null);
    changed();
  }

  function updateGroup(key: string, patch: Partial<GroupState>) {
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
    changed();
  }

  function removeGroup(group: GroupState) {
    if (!group.sectionId) {
      setGroups((gs) => gs.filter((g) => g.key !== group.key));
      if (placing === group.key) setPlacing(null);
      return;
    }
    if (!window.confirm(`¿Borrar "${group.name}" con sus ${group.tables.length} lounges? También se quitan sus precios (si no tienen ventas).`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("sectionId", group.sectionId!);
      const result = await deleteSectionAction(undefined, fd);
      if (result?.error) setMessage({ ok: false, text: result.error });
      else router.refresh();
    });
  }

  function save() {
    const empty = groups.find((g) => g.tables.length === 0);
    if (empty) {
      setMessage({ ok: false, text: `"${empty.name}" no tiene lounges: ponlos en el plano o borra el grupo.` });
      return;
    }
    const plan = {
      items,
      groups: groups.map((g) => ({
        sectionId: g.sectionId,
        name: g.name,
        color: g.color,
        prefix: g.prefix,
        tables: g.tables.map((t) => ({ id: t.id, number: t.number, x: t.x, y: t.y })),
      })),
    };
    startTransition(async () => {
      const result = await saveClubPlanAction(venueId, JSON.stringify(plan));
      if (result?.ok) {
        setDirty(false);
        setPlacing(null);
        setMessage({ ok: true, text: result.message ?? "Plano guardado." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result?.error ?? "No se pudo guardar." });
      }
    });
  }

  const selectedItem = selected?.type === "item" ? items.find((i) => i.id === selected.id) : undefined;
  const selectedTable =
    selected?.type === "table" ? groups.find((g) => g.key === selected.group)?.tables.find((t) => t.key === selected.key) : undefined;
  const selectedTableGroup = selected?.type === "table" ? groups.find((g) => g.key === selected.group) : undefined;
  const placingGroup = groups.find((g) => g.key === placing);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Agregar al plano:</span>
        {MAP_ITEM_KINDS.map((kind) => (
          <button key={kind} type="button" onClick={() => addItem(kind)} className="btn px-2.5 py-1 text-xs" style={{ borderColor: MAP_ITEM_COLOR[kind] }}>
            + {MAP_ITEM_LABEL[kind]}
          </button>
        ))}
      </div>

      {placingGroup && (
        <p className="rounded-md bg-[#f3e8ff] px-3 py-2 text-sm text-[#7b2fbf]">
          Toca el plano donde va cada lounge de <strong>{placingGroup.name}</strong> (se numeran solos). Arrástralos para
          moverlos.{" "}
          <button type="button" onClick={() => setPlacing(null)} className="font-medium underline">
            Listo
          </button>
        </p>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        className={`w-full touch-none select-none rounded-lg border border-[var(--border)] ${placing ? "cursor-crosshair" : ""}`}
        style={{ background: "#fbfbf9" }}
        onPointerDown={onCanvasDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="application"
        aria-label="Plano del boliche"
      >
        {!hasStage(items) && (
          <g opacity={0.35}>
            <rect x={CANVAS_WIDTH / 2 - 160} y={16} width={320} height={20} rx={4} fill="#1a1a18" />
            <text x={CANVAS_WIDTH / 2} y={30} textAnchor="middle" fontSize="10" letterSpacing="2" fill="#fff">
              ESCENARIO (AGRÉGALO PARA MOVERLO)
            </text>
          </g>
        )}
        {zones.map((z) => (
          <g key={z.id} opacity={0.6} pointerEvents="none">
            <path d={zonePath(z.layout)} fill={z.color} fillOpacity={0.18} stroke={z.color} strokeWidth={1.5} strokeDasharray="6 4" />
            <text x={zoneLabelPoint(z.layout).x} y={zoneLabelPoint(z.layout).y} textAnchor="middle" fontSize="14" fontWeight="700" fill={z.color}>
              {z.name}
            </text>
          </g>
        ))}
        {seats.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={5} fill={s.color} opacity={0.35} pointerEvents="none" />
        ))}

        {items.map((item) => {
          const isSel = selected?.type === "item" && selected.id === item.id;
          const color = MAP_ITEM_COLOR[item.kind];
          return (
            <g
              key={item.id}
              className="cursor-move"
              onPointerDown={(e) => {
                setSelected({ type: "item", id: item.id });
                const p = point(e);
                startDrag(e, { kind: "item", key: item.id, startX: p.x, startY: p.y, origin: { x: item.x, y: item.y } });
              }}
            >
              <rect
                x={item.x}
                y={item.y}
                width={item.width}
                height={item.height}
                rx={8}
                fill={item.kind === "LABEL" ? "transparent" : color}
                fillOpacity={0.25}
                stroke={color}
                strokeWidth={isSel ? 3 : 1.5}
                strokeDasharray={isSel || item.kind === "LABEL" ? "6 4" : undefined}
              />
              <text
                x={item.x + item.width / 2}
                y={item.y + item.height / 2 + 5}
                textAnchor="middle"
                fontSize={Math.min(16, Math.max(10, item.height / 2.6))}
                fontWeight="700"
                letterSpacing="1"
                fill="#1a1a18"
                pointerEvents="none"
              >
                {item.label.toUpperCase()}
              </text>
              {isSel && (
                <rect
                  x={item.x + item.width - 9}
                  y={item.y + item.height - 9}
                  width={14}
                  height={14}
                  rx={3}
                  fill="#fff"
                  stroke={color}
                  strokeWidth={2}
                  className="cursor-nwse-resize"
                  onPointerDown={(e) => {
                    const p = point(e);
                    startDrag(e, { kind: "resize", key: item.id, startX: p.x, startY: p.y, origin: { x: item.x, y: item.y, w: item.width, h: item.height } });
                  }}
                />
              )}
            </g>
          );
        })}

        {groups.map((g) =>
          g.tables.map((t) => {
            const isSel = selected?.type === "table" && selected.key === t.key;
            return (
              <g
                key={t.key}
                className="cursor-move"
                onPointerDown={(e) => {
                  setSelected({ type: "table", group: g.key, key: t.key });
                  const p = point(e);
                  startDrag(e, { kind: "table", group: g.key, key: t.key, startX: p.x, startY: p.y, origin: { x: t.x, y: t.y } });
                }}
              >
                <circle
                  cx={t.x}
                  cy={t.y}
                  r={TABLE_RADIUS}
                  fill={g.color}
                  fillOpacity={placing && placing !== g.key ? 0.15 : 0.35}
                  stroke={isSel ? "#1a1a18" : g.color}
                  strokeWidth={isSel ? 3 : 2}
                  strokeDasharray={t.sold ? "3 3" : undefined}
                />
                <text x={t.x} y={t.y + 5} textAnchor="middle" fontSize="14" fontWeight="800" fill="#1a1a18" pointerEvents="none">
                  {t.number}
                </text>
              </g>
            );
          }),
        )}
      </svg>

      {selectedItem && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--border)] p-3">
          <label className="label">
            {MAP_ITEM_LABEL[selectedItem.kind]}: texto
            <input value={selectedItem.label} maxLength={30} onChange={(e) => updateItem(selectedItem.id, { label: e.target.value })} className="field w-48" />
          </label>
          <label className="label">
            Ancho
            <input
              type="number"
              min={MIN_ITEM_SIZE}
              max={CANVAS_WIDTH}
              value={selectedItem.width}
              onChange={(e) => updateItem(selectedItem.id, { width: clamp(Number(e.target.value) || MIN_ITEM_SIZE, MIN_ITEM_SIZE, CANVAS_WIDTH - selectedItem.x) })}
              className="field w-24"
            />
          </label>
          <label className="label">
            Alto
            <input
              type="number"
              min={MIN_ITEM_SIZE}
              max={CANVAS_HEIGHT}
              value={selectedItem.height}
              onChange={(e) => updateItem(selectedItem.id, { height: clamp(Number(e.target.value) || MIN_ITEM_SIZE, MIN_ITEM_SIZE, CANVAS_HEIGHT - selectedItem.y) })}
              className="field w-24"
            />
          </label>
          <button type="button" onClick={removeSelected} className="text-sm text-[var(--danger)] hover:underline">
            Quitar del plano
          </button>
          <p className="basis-full text-xs text-[var(--ink-dim)]">Arrástralo para moverlo; el cuadrito de la esquina lo agranda o achica.</p>
        </div>
      )}

      {selectedTable && selectedTableGroup && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--border)] p-3 text-sm">
          <span className="font-medium">
            {selectedTableGroup.prefix} {selectedTable.number} · {selectedTableGroup.name}
          </span>
          {selectedTable.sold ? (
            <span className="text-[var(--ink-dim)]">Tiene ventas: se puede mover, no quitar.</span>
          ) : (
            <button type="button" onClick={removeSelected} className="text-[var(--danger)] hover:underline">
              Quitar este lounge
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Lounges y mesas (cada círculo es uno; el comprador elige el suyo en el mapa)</p>
        {groups.length === 0 && <p className="text-sm text-[var(--ink-muted)]">Todavía no hay lounges en el plano.</p>}
        {groups.map((g) => (
          <div key={g.key} className={`flex flex-wrap items-end gap-3 rounded-md border p-3 ${placing === g.key ? "border-[#c04bff]" : "border-[var(--border)]"}`}>
            <label className="label">
              Color
              <input type="color" value={g.color} onChange={(e) => updateGroup(g.key, { color: e.target.value })} className="h-[38px] w-12 rounded border border-[var(--border)]" />
            </label>
            <label className="label">
              Nombre del grupo
              <input value={g.name} maxLength={60} onChange={(e) => updateGroup(g.key, { name: e.target.value })} className="field w-44" />
            </label>
            <label className="label">
              Cada uno se llama
              <input value={g.prefix} maxLength={20} onChange={(e) => updateGroup(g.key, { prefix: e.target.value })} className="field w-32" placeholder="Lounge" />
            </label>
            <span className="self-center text-sm text-[var(--ink-muted)]">{g.tables.length} en el plano</span>
            <button type="button" onClick={() => setPlacing(placing === g.key ? null : g.key)} className={`btn text-xs ${placing === g.key ? "btn-dark" : ""}`}>
              {placing === g.key ? "Poniendo lounges… (Listo)" : "Poner lounges"}
            </button>
            <button
              type="button"
              onClick={() => removeGroup(g)}
              disabled={g.tables.some((t) => t.sold)}
              title={g.tables.some((t) => t.sold) ? "Tiene ventas: no se puede borrar" : undefined}
              className="text-xs text-[var(--danger)] hover:underline disabled:opacity-40"
            >
              Borrar grupo
            </button>
          </div>
        ))}
        <button type="button" onClick={addGroup} className="btn text-sm">
          + Nuevo grupo de lounges
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
        <button type="button" onClick={save} disabled={pending || !dirty} className="btn btn-dark disabled:opacity-50">
          {pending ? "Guardando…" : "Guardar plano"}
        </button>
        {dirty && !pending && <span className="text-sm text-[var(--warn)]">Tienes cambios sin guardar.</span>}
        {message && (
          <span role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-[var(--accent)]" : "text-[var(--danger)]"}`}>
            {message.text}
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--ink-dim)]">
        Después, en los precios de cada noche, elige el grupo (ej. &ldquo;Lounges VIP&rdquo;) como sección, marca &ldquo;Es una mesa o
        lounge&rdquo; con cuántas personas entran y el consumo incluido: cada lounge se vende una vez y su gente entra con un QR por
        persona.
      </p>
    </div>
  );
}
