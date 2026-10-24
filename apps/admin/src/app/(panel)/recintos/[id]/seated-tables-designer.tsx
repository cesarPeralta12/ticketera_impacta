"use client";

import { useMemo, useState } from "react";
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
  type TableSaleMode,
  type TableShape,
} from "@ticketera/core";
import { ActionForm } from "@/components/action-form";
import { MapDecor } from "@/components/map-decor";
import { PlanBackground, type PlanBackgroundInfo } from "@/components/plan-background";
import { addSeatedTablesSectionAction } from "@/lib/actions/venues";

type Background = { x: number; y: number; color: string };

/**
 * Mesas con sillas alrededor (cena show, gala, matrimonio): se arman en una grilla y se ve en vivo cómo quedan sobre
 * el mapa del recinto. Cada silla es una butaca; la mesa se vende completa, por silla o de N a M sillas.
 */
export function SeatedTablesDesigner({ venueId, background, plan, items = [] }: { venueId: string; background: Background[]; plan?: PlanBackgroundInfo; items?: MapItem[] }) {
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
  const size = shape === "round" ? 22 : 30;

  const draft = useMemo(
    () => ({
      type: "seated",
      prefix,
      shape,
      chairs,
      mode,
      min,
      max,
      size,
      tables: seatedTablesGrid({ count, perRow: Math.max(1, perRow), x, y, gapX, gapY }),
    }),
    [prefix, shape, chairs, mode, min, max, size, count, perRow, x, y, gapX, gapY],
  );
  const parsed = parseSeatedTablesLayout(draft);
  const chairsDrawn = parsed.ok ? seatedTableSeats(parsed.layout) : [];
  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value));

  return (
    <div className="card space-y-4 p-6">
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

      <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} className="w-full rounded-lg border border-[var(--border)]" style={{ background: "#fbfbf9" }} role="img" aria-label="Vista previa de las mesas">
        <PlanBackground background={plan} />
        <MapDecor items={items} />
        {background.map((b, i) => (
          <circle key={i} cx={b.x} cy={b.y} r={4} fill={b.color} opacity={0.25} />
        ))}
        {draft.tables.map((t) =>
          shape === "round" ? (
            <g key={t.number}>
              <circle cx={t.x} cy={t.y} r={size} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={2} />
              <text x={t.x} y={t.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a1a18">
                {t.number}
              </text>
            </g>
          ) : (
            <g key={t.number}>
              <rect x={t.x - size} y={t.y - tableHeight(size) / 2} width={size * 2} height={tableHeight(size)} rx={4} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={2} />
              <text x={t.x} y={t.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a1a18">
                {t.number}
              </text>
            </g>
          ),
        )}
        {chairsDrawn.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={6} fill="#fff" stroke={color} strokeWidth={2} />
        ))}
      </svg>
      {!parsed.ok && <p className="text-sm text-[var(--danger)]">{parsed.error}</p>}

      <ActionForm action={addSeatedTablesSectionAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="venueId" value={venueId} />
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="color" value={color} />
        <input type="hidden" name="layout" value={JSON.stringify(draft)} />
        <button type="submit" disabled={!parsed.ok} className="btn btn-dark disabled:cursor-not-allowed disabled:opacity-50">
          Crear {count} mesas ({count * chairs} sillas)
        </button>
      </ActionForm>
    </div>
  );
}
