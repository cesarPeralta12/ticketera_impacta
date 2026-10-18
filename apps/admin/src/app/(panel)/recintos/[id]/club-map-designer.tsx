"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from "react";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAP_ITEM_COLOR,
  MAP_ITEM_KINDS,
  MAP_ITEM_LABEL,
  MIN_ITEM_SIZE,
  SECTION_COLORS,
  TABLE_RADIUS,
  reservadoSize,
  defaultMapItem,
  hasStage,
  nextTableNumber,
  zoneLabelPoint,
  zonePath,
  type MapItem,
  type MapItemKind,
  type ZoneShape,
} from "@ticketera/core";
import { PlanBackground, type PlanBackgroundInfo } from "@/components/plan-background";
import { deleteSectionAction, saveClubPlanAction } from "@/lib/actions/venues";

export type DesignerTableGroup = {
  sectionId: string;
  name: string;
  color: string;
  prefix: string;
  /** "rect": reservado (rectángulo); "round": lounge o mesa (círculo). */
  shape: "round" | "rect";
  tables: { id: string; number: number; x: number; y: number; sold: boolean }[];
};

type TableState = { key: string; id?: string; number: number; x: number; y: number; sold: boolean };
type GroupState = { key: string; sectionId?: string; name: string; color: string; prefix: string; shape: "round" | "rect"; tables: TableState[] };
type Selection = { type: "item"; id: string } | { type: "table"; group: string; key: string } | null;
type Snapshot = { items: MapItem[]; groups: GroupState[] };
type Clip = { type: "item"; item: MapItem } | { type: "table"; group: string; table: TableState };
type Box = { key: string; x: number; y: number; w: number; h: number };
type Align = "left" | "hcenter" | "right" | "top" | "vmiddle" | "bottom" | "hspread" | "vspread";

/** Clave de un objeto del plano en la selección: "item:<id>" o "table:<grupo>:<lounge>". */
const keyOf = (s: NonNullable<Selection>) => (s.type === "item" ? `item:${s.id}` : `table:${s.group}:${s.key}`);
function selectionOf(key: string): NonNullable<Selection> {
  const [type, a, b] = key.split(":");
  return type === "item" ? { type: "item", id: a! } : { type: "table", group: a!, key: b! };
}
const HISTORY = 50;
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
  /** Imagen del plano real para calcar (si se subió). */
  background?: PlanBackgroundInfo;
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
  background,
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
      shape: g.shape,
      tables: g.tables.map((t) => ({ key: t.id, id: t.id, number: t.number, x: t.x, y: t.y, sold: t.sold })),
    })),
  );
  const [selected, setSelected] = useState<Selection>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  // Selección múltiple (Mayús + clic): para alinear, distribuir, mover con el teclado o quitar juntos.
  const [multi, setMulti] = useState<string[]>([]);
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  const clipboard = useRef<Clip | null>(null);
  const [showBackground, setShowBackground] = useState(true);

  const changed = () => {
    setDirty(true);
    setMessage(null);
  };

  /** Guarda cómo estaba el plano antes de un cambio (para deshacer). */
  function remember() {
    past.current = [...past.current.slice(-(HISTORY - 1)), { items, groups }];
    future.current = [];
    setHistorySize({ past: past.current.length, future: 0 });
  }

  function undo() {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push({ items, groups });
    setItems(previous.items);
    setGroups(previous.groups);
    setHistorySize({ past: past.current.length, future: future.current.length });
    changed();
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push({ items, groups });
    setItems(next.items);
    setGroups(next.groups);
    setHistorySize({ past: past.current.length, future: future.current.length });
    changed();
  }

  /** Toca un objeto: lo elige (con Mayús, lo suma o lo saca de la selección). */
  function pick(sel: NonNullable<Selection>, additive: boolean) {
    const key = keyOf(sel);
    setSelected(sel);
    setMulti((m) => (additive ? (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]) : [key]));
  }

  function clearSelection() {
    setSelected(null);
    setMulti([]);
  }

  const tableBox = (group: GroupState, t: TableState) => {
    const { width, height } = group.shape === "rect" ? reservadoSize(TABLE_RADIUS) : { width: TABLE_RADIUS * 2, height: TABLE_RADIUS * 2 };
    return { x: t.x - width / 2, y: t.y - height / 2, w: width, h: height };
  };

  /** Rectángulo de cada objeto elegido (esquina y tamaño), para alinear y mover. */
  function boxes(keys: string[]): Box[] {
    return keys.flatMap((key) => {
      const sel = selectionOf(key);
      if (sel.type === "item") {
        const item = items.find((i) => i.id === sel.id);
        return item ? [{ key, x: item.x, y: item.y, w: item.width, h: item.height }] : [];
      }
      const group = groups.find((g) => g.key === sel.group);
      const table = group?.tables.find((t) => t.key === sel.key);
      return group && table ? [{ key, ...tableBox(group, table) }] : [];
    });
  }

  /** Lleva cada objeto a su nueva esquina (sin salirse del plano). */
  function moveBoxes(moves: Map<string, { x: number; y: number }>) {
    setItems((its) =>
      its.map((i) => {
        const m = moves.get(`item:${i.id}`);
        return m ? { ...i, x: Math.round(clamp(m.x, 0, CANVAS_WIDTH - i.width)), y: Math.round(clamp(m.y, 0, CANVAS_HEIGHT - i.height)) } : i;
      }),
    );
    setGroups((gs) =>
      gs.map((g) => ({
        ...g,
        tables: g.tables.map((t) => {
          const m = moves.get(`table:${g.key}:${t.key}`);
          if (!m) return t;
          const box = tableBox(g, t);
          return {
            ...t,
            x: Math.round(clamp(m.x + box.w / 2, box.w / 2, CANVAS_WIDTH - box.w / 2)),
            y: Math.round(clamp(m.y + box.h / 2, box.h / 2, CANVAS_HEIGHT - box.h / 2)),
          };
        }),
      })),
    );
    changed();
  }

  function nudge(dx: number, dy: number) {
    const list = boxes(multi);
    if (list.length === 0) return;
    remember();
    moveBoxes(new Map(list.map((b) => [b.key, { x: b.x + dx, y: b.y + dy }])));
  }

  function align(kind: Align) {
    const list = boxes(multi);
    if (list.length < 2 || ((kind === "hspread" || kind === "vspread") && list.length < 3)) return;
    remember();
    const minX = Math.min(...list.map((b) => b.x));
    const maxX = Math.max(...list.map((b) => b.x + b.w));
    const minY = Math.min(...list.map((b) => b.y));
    const maxY = Math.max(...list.map((b) => b.y + b.h));
    const moves = new Map<string, { x: number; y: number }>();
    if (kind === "hspread" || kind === "vspread") {
      const horizontal = kind === "hspread";
      const sorted = list.toSorted((a, b) => (horizontal ? a.x + a.w / 2 - (b.x + b.w / 2) : a.y + a.h / 2 - (b.y + b.h / 2)));
      const first = sorted[0]!;
      const last = sorted.at(-1)!;
      const start = horizontal ? first.x + first.w / 2 : first.y + first.h / 2;
      const end = horizontal ? last.x + last.w / 2 : last.y + last.h / 2;
      sorted.forEach((b, i) => {
        const center = start + ((end - start) * i) / (sorted.length - 1);
        moves.set(b.key, horizontal ? { x: center - b.w / 2, y: b.y } : { x: b.x, y: center - b.h / 2 });
      });
    } else {
      for (const b of list) {
        const x = kind === "left" ? minX : kind === "right" ? maxX - b.w : kind === "hcenter" ? (minX + maxX) / 2 - b.w / 2 : b.x;
        const y = kind === "top" ? minY : kind === "bottom" ? maxY - b.h : kind === "vmiddle" ? (minY + maxY) / 2 - b.h / 2 : b.y;
        moves.set(b.key, { x, y });
      }
    }
    moveBoxes(moves);
  }

  function copy() {
    if (!selected) return;
    if (selected.type === "item") {
      const item = items.find((i) => i.id === selected.id);
      if (item) clipboard.current = { type: "item", item };
    } else {
      const table = groups.find((g) => g.key === selected.group)?.tables.find((t) => t.key === selected.key);
      if (table) clipboard.current = { type: "table", group: selected.group, table };
    }
    setMessage({ ok: true, text: "Copiado: Ctrl+V para pegar." });
  }

  /** Pega lo copiado un poco corrido (un lounge pegado toma el número siguiente de su grupo). */
  function paste() {
    const clip = clipboard.current;
    if (!clip) return;
    remember();
    if (clip.type === "item") {
      const item: MapItem = {
        ...clip.item,
        id: newKey("i"),
        x: Math.round(clamp(clip.item.x + 20, 0, CANVAS_WIDTH - clip.item.width)),
        y: Math.round(clamp(clip.item.y + 20, 0, CANVAS_HEIGHT - clip.item.height)),
      };
      setItems((its) => [...its, item]);
      pick({ type: "item", id: item.id }, false);
      clipboard.current = { type: "item", item };
    } else {
      const group = groups.find((g) => g.key === clip.group);
      if (!group) return;
      const step = group.shape === "rect" ? reservadoSize(TABLE_RADIUS).width + 8 : TABLE_RADIUS * 2 + 8;
      const right = clip.table.x + step <= CANVAS_WIDTH - TABLE_RADIUS;
      const table: TableState = {
        key: newKey("t"),
        number: nextTableNumber(group.tables),
        x: Math.round(right ? clip.table.x + step : clip.table.x),
        y: Math.round(right ? clip.table.y : clamp(clip.table.y + step, TABLE_RADIUS, CANVAS_HEIGHT - TABLE_RADIUS)),
        sold: false,
      };
      setGroups((gs) => gs.map((g) => (g.key === group.key ? { ...g, tables: [...g.tables, table] } : g)));
      pick({ type: "table", group: group.key, key: table.key }, false);
      clipboard.current = { type: "table", group: group.key, table };
    }
    changed();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Escribiendo en un campo, las teclas son del campo.
    if ((event.target as HTMLElement).closest("input, select, textarea")) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && key === "y") {
      event.preventDefault();
      redo();
    } else if (mod && key === "c") {
      event.preventDefault();
      copy();
    } else if (mod && key === "v") {
      event.preventDefault();
      paste();
    } else if (mod && key === "d") {
      event.preventDefault();
      copy();
      paste();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeSelected();
    } else if (event.key === "Escape") {
      clearSelection();
      setPlacing(null);
    } else if (event.key.startsWith("Arrow") && multi.length > 0) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      nudge(event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
    }
  }

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
    remember();
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
      clearSelection();
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
    remember();
    setGroups((gs) => gs.map((g) => (g.key === placing ? { ...g, tables: [...g.tables, table] } : g)));
    pick({ type: "table", group: placing, key: table.key }, false);
    changed();
  }

  function addItem(kind: MapItemKind) {
    const at = kind === "STAGE" ? { x: CANVAS_WIDTH / 2, y: 50 } : { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    const item = defaultMapItem(kind, at, newKey("i"));
    remember();
    setItems((its) => [...its, item]);
    pick({ type: "item", id: item.id }, false);
    setPlacing(null);
    changed();
  }

  function updateItem(id: string, patch: Partial<MapItem>) {
    remember();
    setItems((its) => its.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    changed();
  }

  /** Quita lo elegido (los lounges con ventas se pueden mover, no quitar). */
  function removeSelected() {
    const keys = multi.length ? multi : selected ? [keyOf(selected)] : [];
    if (keys.length === 0) return;
    const soldKeys = keys.filter((k) => {
      const sel = selectionOf(k);
      return sel.type === "table" && groups.find((g) => g.key === sel.group)?.tables.find((t) => t.key === sel.key)?.sold;
    });
    const removable = new Set(keys.filter((k) => !soldKeys.includes(k)));
    if (removable.size === 0) {
      setMessage({ ok: false, text: "Ese lounge ya tiene ventas: se puede mover, pero no quitar." });
      return;
    }
    remember();
    setItems((its) => its.filter((i) => !removable.has(`item:${i.id}`)));
    setGroups((gs) => gs.map((g) => ({ ...g, tables: g.tables.filter((t) => !removable.has(`table:${g.key}:${t.key}`)) })));
    if (soldKeys.length) setMessage({ ok: false, text: `${soldKeys.length} lounge(s) con ventas no se quitaron (se pueden mover).` });
    clearSelection();
    changed();
  }

  function addGroup() {
    const n = groups.length + 1;
    const group: GroupState = {
      key: newKey("g"),
      name: n === 1 ? "Lounges VIP" : `Lounges ${n}`,
      color: SECTION_COLORS[(n + 3) % SECTION_COLORS.length]!,
      prefix: "Lounge",
      shape: "round",
      tables: [],
    };
    remember();
    setGroups((gs) => [...gs, group]);
    setPlacing(group.key);
    clearSelection();
    changed();
  }

  function updateGroup(key: string, patch: Partial<GroupState>) {
    remember();
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
        shape: g.shape,
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

  const canAlign = boxes(multi).length >= 2;
  const canSpread = boxes(multi).length >= 3;
  const tool = "btn px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40";
  const ALIGN: { kind: Align; label: string; title: string; spread?: boolean }[] = [
    { kind: "left", label: "⇤", title: "Alinear a la izquierda" },
    { kind: "hcenter", label: "↔", title: "Centrar en horizontal" },
    { kind: "right", label: "⇥", title: "Alinear a la derecha" },
    { kind: "top", label: "⤒", title: "Alinear arriba" },
    { kind: "vmiddle", label: "↕", title: "Centrar en vertical" },
    { kind: "bottom", label: "⤓", title: "Alinear abajo" },
    { kind: "hspread", label: "⋯", title: "Repartir a lo ancho (3 o más)", spread: true },
    { kind: "vspread", label: "⋮", title: "Repartir a lo alto (3 o más)", spread: true },
  ];

  return (
    <div className="space-y-4" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Herramientas del plano">
        <button type="button" onClick={undo} disabled={historySize.past === 0} className={tool} title="Deshacer (Ctrl+Z)">
          ↶ Deshacer
        </button>
        <button type="button" onClick={redo} disabled={historySize.future === 0} className={tool} title="Rehacer (Ctrl+Y)">
          ↷ Rehacer
        </button>
        <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden />
        <button type="button" onClick={copy} disabled={!selected} className={tool} title="Copiar (Ctrl+C)">
          Copiar
        </button>
        <button type="button" onClick={paste} className={tool} title="Pegar (Ctrl+V)">
          Pegar
        </button>
        <button
          type="button"
          onClick={() => {
            copy();
            paste();
          }}
          disabled={!selected}
          className={tool}
          title="Duplicar (Ctrl+D)"
        >
          Duplicar
        </button>
        <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden />
        {ALIGN.map((a) => (
          <button key={a.kind} type="button" onClick={() => align(a.kind)} disabled={a.spread ? !canSpread : !canAlign} className={`${tool} w-8`} title={a.title} aria-label={a.title}>
            {a.label}
          </button>
        ))}
        {background && (
          <>
            <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={showBackground} onChange={(e) => setShowBackground(e.target.checked)} /> Plano de fondo
            </label>
          </>
        )}
      </div>
      <p className="text-xs text-[var(--ink-dim)]">
        Mayús + clic elige varios (para alinear o repartir) · flechas mueven lo elegido (Mayús = de a 10) · Supr lo quita · Esc suelta la selección.
      </p>

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

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
      <svg
        ref={svgRef}
        tabIndex={0}
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
        {showBackground && <PlanBackground background={background} />}
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
          const isSel = multi.includes(`item:${item.id}`);
          const color = MAP_ITEM_COLOR[item.kind];
          return (
            <g
              key={item.id}
              className="cursor-move"
              onPointerDown={(e) => {
                pick({ type: "item", id: item.id }, e.shiftKey);
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
            const isSel = multi.includes(`table:${g.key}:${t.key}`);
            return (
              <g
                key={t.key}
                className="cursor-move"
                onPointerDown={(e) => {
                  pick({ type: "table", group: g.key, key: t.key }, e.shiftKey);
                  const p = point(e);
                  startDrag(e, { kind: "table", group: g.key, key: t.key, startX: p.x, startY: p.y, origin: { x: t.x, y: t.y } });
                }}
              >
                {g.shape === "rect" ? (
                  <rect
                    x={t.x - reservadoSize(TABLE_RADIUS).width / 2}
                    y={t.y - reservadoSize(TABLE_RADIUS).height / 2}
                    width={reservadoSize(TABLE_RADIUS).width}
                    height={reservadoSize(TABLE_RADIUS).height}
                    rx={6}
                    fill={g.color}
                    fillOpacity={placing && placing !== g.key ? 0.15 : 0.35}
                    stroke={isSel ? "#1a1a18" : g.color}
                    strokeWidth={isSel ? 3 : 2}
                    strokeDasharray={t.sold ? "3 3" : undefined}
                  />
                ) : (
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
                )}
                <text x={t.x} y={t.y + 5} textAnchor="middle" fontSize="14" fontWeight="800" fill="#1a1a18" pointerEvents="none">
                  {t.number}
                </text>
              </g>
            );
          }),
        )}
      </svg>
      <div className="max-h-[420px] overflow-y-auto rounded-lg border border-[var(--border)]" role="listbox" aria-label="Objetos del plano" aria-multiselectable>
        <p className="sticky top-0 bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--ink-muted)]">
          Objetos ({items.length + groups.reduce((n, g) => n + g.tables.length, 0)})
        </p>
        {items.map((item) => {
          const key = `item:${item.id}`;
          return (
            <button
              key={key}
              type="button"
              role="option"
              aria-selected={multi.includes(key)}
              onClick={(e) => pick({ type: "item", id: item.id }, e.shiftKey)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${multi.includes(key) ? "bg-[var(--accent-soft)] font-medium" : "hover:bg-[var(--surface-2)]"}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: MAP_ITEM_COLOR[item.kind] }} />
              {item.label}
              <span className="ml-auto text-[var(--ink-dim)]">{MAP_ITEM_LABEL[item.kind]}</span>
            </button>
          );
        })}
        {groups.map((g) =>
          g.tables.map((t) => {
            const key = `table:${g.key}:${t.key}`;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={multi.includes(key)}
                onClick={(e) => pick({ type: "table", group: g.key, key: t.key }, e.shiftKey)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${multi.includes(key) ? "bg-[var(--accent-soft)] font-medium" : "hover:bg-[var(--surface-2)]"}`}
              >
                <span className={`h-2.5 w-2.5 shrink-0 ${g.shape === "rect" ? "rounded-sm" : "rounded-full"}`} style={{ background: g.color }} />
                {g.prefix} {t.number}
                <span className="ml-auto text-[var(--ink-dim)]">{t.sold ? "con ventas" : g.name}</span>
              </button>
            );
          }),
        )}
      </div>
      </div>

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
            <label className="label">
              Forma
              <select value={g.shape} onChange={(e) => updateGroup(g.key, { shape: e.target.value as "round" | "rect" })} className="field w-auto">
                <option value="round">Lounge o mesa (círculo)</option>
                <option value="rect">Reservado (rectángulo)</option>
              </select>
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
