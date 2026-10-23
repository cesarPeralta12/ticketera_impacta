"use client";

import type { KeyboardEvent, SVGProps } from "react";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAP_ITEM_COLOR,
  formatMoney,
  hasStage,
  reservadoSize,
  tableHeight,
  zoneLabelPoint,
  zonePath,
  zoneSize,
  type MapItem,
  type SeatedTablesLayout,
  type ZoneShape,
} from "@ticketera/core";

/** `short`: el número que va dentro de un lounge en círculo. */
/** `group`: en mesas con sillas, la mesa de la silla. */
export type PickerSeat = { id: string; label: string; x: number; y: number; taken: boolean; short?: string; group?: string };
export type PickerSection = {
  ticketTypeId: string;
  name: string;
  color: string;
  unitAmount: number;
  currency: string;
  /** Precio de preventa: se marca en el mapa. */
  presale: boolean;
  /** Descuento de preventa vigente (%): el unitAmount ya lo incluye. */
  discountPercent?: number | null;
  seats: PickerSeat[];
  /** Lounges o mesas en círculo: cada "butaca" es una mesa y se dibuja más grande, con su número. */
  round?: { radius: number; shape?: "round" | "rect" } | null;
  /** Mesas con sillas: cómo se venden y dónde van las mesas (las sillas son las butacas). */
  seatedTables?: Omit<SeatedTablesLayout, "type"> | null;
};

/** Zona de entrada general dibujada en el mapa: no se eligen butacas, la cantidad se elige en la lista. */
export type PickerZone = {
  sectionId: string;
  name: string;
  color: string;
  zone: ZoneShape;
  /** Lugares que quedan en toda la zona (Preventa + General comparten el aforo). */
  left: number;
  capacity: number;
  /** Precio más bajo a la venta ahora, ya formateado ("Bs 90"); null si todavía no se vende. */
  fromPrice: string | null;
};

/**
 * Mapa de butacas del comprador: dibuja la forma real que diseñó el organizador (idea del
 * prototipo del compañero), en SVG. Elegir butacas no las bloquea: la reserva se hace al
 * confirmar la compra, de forma atómica. Así nadie puede "acaparar" butacas sin comprar.
 */
export function SeatPicker({
  sections,
  selected,
  onToggle,
  zones = [],
  zoneCounts = {},
  onZoneClick,
  items = [],
}: {
  sections: PickerSection[];
  selected: Set<string>;
  onToggle: (ticketTypeId: string, seatId: string) => void;
  zones?: PickerZone[];
  /** Cuántas entradas lleva elegidas el comprador en cada zona (por sectionId). */
  zoneCounts?: Record<string, number>;
  onZoneClick?: (sectionId: string) => void;
  /** Plano del boliche: escenario, barras, DJ, entrada, baños (no se venden). */
  items?: MapItem[];
}) {
  // Etiqueta sobre el centro de la sección (en un arco, las puntas suben más que el centro):
  // nombre, precio y butacas libres sobre el total.
  const labels = sections.map((s) => {
    const xs = s.seats.map((seat) => seat.x);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const midX = (minX + maxX) / 2;
    const tolerance = Math.max(15, (maxX - minX) * 0.05);
    const middle = s.seats.filter((seat) => Math.abs(seat.x - midX) <= tolerance);
    const y = Math.min(...(middle.length ? middle : s.seats).map((seat) => seat.y));
    const free = s.seats.filter((seat) => !seat.taken).length;
    const price = `${s.presale ? "PREVENTA " : ""}${s.discountPercent ? `-${s.discountPercent}% ` : ""}${formatMoney(s.unitAmount, s.currency)}`;
    const detail = free === 0 ? "AGOTADO" : `${price} · ${free}/${s.seats.length} libres`;
    return { name: s.name, color: s.color, x: midX, y: y - 36, detail };
  });

  function onKey(event: KeyboardEvent, ticketTypeId: string, seatId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle(ticketTypeId, seatId);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl bg-[var(--bg)]">
      <svg
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        className="w-full min-w-[640px] select-none"
        role="group"
        aria-label="Mapa de butacas"
      >
        <defs>
          <linearGradient id="escenario" x1="0" x2="1">
            <stop offset="0" stopColor="#F5B700" stopOpacity="0" />
            <stop offset="0.5" stopColor="#F5B700" stopOpacity="0.7" />
            <stop offset="1" stopColor="#F5B700" stopOpacity="0" />
          </linearGradient>
        </defs>
        {!hasStage(items) && (
          <>
            <rect x={CANVAS_WIDTH / 2 - 160} y={18} width={320} height={16} rx={8} fill="url(#escenario)" />
            <text x={CANVAS_WIDTH / 2} y={56} textAnchor="middle" fontSize="11" letterSpacing="4" fill="#7D89A3">
              ESCENARIO
            </text>
          </>
        )}
        {items.map((item) => (
          <g key={item.id} pointerEvents="none">
            <rect
              x={item.x}
              y={item.y}
              width={item.width}
              height={item.height}
              rx={8}
              fill={item.kind === "LABEL" ? "transparent" : MAP_ITEM_COLOR[item.kind]}
              fillOpacity={item.kind === "STAGE" ? 0.35 : 0.16}
              stroke={MAP_ITEM_COLOR[item.kind]}
              strokeOpacity={0.8}
              strokeWidth={1.5}
              strokeDasharray={item.kind === "LABEL" ? "6 4" : undefined}
            />
            <text
              x={item.x + item.width / 2}
              y={item.y + item.height / 2 + 5}
              textAnchor="middle"
              fontSize={Math.min(16, Math.max(10, item.height / 2.6))}
              fontWeight="700"
              letterSpacing="2"
              fill={item.kind === "LABEL" ? "#C3CCDD" : MAP_ITEM_COLOR[item.kind]}
            >
              {item.label.toUpperCase()}
            </text>
          </g>
        ))}

        {zones.map((z) => {
          const sold = z.left === 0;
          const count = zoneCounts[z.sectionId] ?? 0;
          const p = zoneLabelPoint(z.zone);
          const { width, height } = zoneSize(z.zone);
          // El texto se reduce si la zona es angosta; con poco alto se deja solo el nombre.
          const big = Math.min(width, height) >= 90;
          const detail = sold ? "AGOTADO" : `Quedan ${z.left}${z.fromPrice ? ` · ${z.fromPrice}` : ""}`;
          return (
            <g
              key={z.sectionId}
              role="button"
              tabIndex={0}
              aria-label={`${z.name}: ${detail}${count ? `, ${count} elegidas` : ""}. Elige la cantidad en la lista de abajo.`}
              className="cursor-pointer outline-none focus-visible:opacity-80"
              onClick={() => onZoneClick?.(z.sectionId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onZoneClick?.(z.sectionId);
                }
              }}
            >
              <title>{`${z.name} · ${detail}`}</title>
              <path
                d={zonePath(z.zone)}
                fill={sold ? "#2A3751" : z.color}
                fillOpacity={sold ? 0.6 : count > 0 ? 0.55 : 0.22}
                stroke={count > 0 ? "#F5B700" : z.color}
                strokeWidth={count > 0 ? 3.5 : 2}
                strokeDasharray={sold ? "6 5" : undefined}
              />
              <text x={p.x} y={p.y - (big ? 6 : 0)} textAnchor="middle" fontSize={big ? 17 : 13} fontWeight="700" fill={sold ? "#7D89A3" : z.color}>
                {z.name.toUpperCase()}
              </text>
              {big && (
                <text x={p.x} y={p.y + 14} textAnchor="middle" fontSize="13" fontWeight="600" fill="#C3CCDD">
                  {detail}
                </text>
              )}
              {count > 0 && (
                <text x={p.x} y={p.y + (big ? 34 : 18)} textAnchor="middle" fontSize="15" fontWeight="800" fill="#F5B700">
                  × {count}
                </text>
              )}
            </g>
          );
        })}

        {labels.map((l) => (
          <g key={l.name}>
            <text x={l.x} y={l.y} textAnchor="middle" fontSize="15" fontWeight="700" fill={l.color}>
              {l.name.toUpperCase()}
            </text>
            <text x={l.x} y={l.y + 18} textAnchor="middle" fontSize="14" fontWeight="600" fill="#C3CCDD">
              {l.detail}
            </text>
          </g>
        ))}

        {sections.map((section) =>
          section.seatedTables?.tables.map((t) => {
            const st = section.seatedTables!;
            const chosen = section.seats.some((seat) => seat.group === String(t.number) && selected.has(seat.id));
            const free = section.seats.some((seat) => seat.group === String(t.number) && !seat.taken);
            const fill = chosen ? "#F5B700" : free ? section.color : "#2A3751";
            return (
              <g key={`${section.ticketTypeId}-${t.number}`} pointerEvents="none">
                {st.shape === "round" ? (
                  <circle cx={t.x} cy={t.y} r={st.size} fill={fill} fillOpacity={chosen ? 0.45 : 0.18} stroke={fill} strokeWidth={1.5} />
                ) : (
                  <rect x={t.x - st.size} y={t.y - tableHeight(st.size) / 2} width={st.size * 2} height={tableHeight(st.size)} rx={4} fill={fill} fillOpacity={chosen ? 0.45 : 0.18} stroke={fill} strokeWidth={1.5} />
                )}
                <text x={t.x} y={t.y + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill={free ? "#F5F6F8" : "#7D89A3"}>
                  {t.number}
                </text>
              </g>
            );
          }),
        )}

        {sections.map((section) =>
          section.seats.map((seat) => {
            const isSelected = selected.has(seat.id);
            const r = section.round ? section.round.radius : section.seatedTables ? 6 : 7;
            const rect = section.round?.shape === "rect";
            // Accesibilidad: además del color, la butaca ocupada lleva × y la elegida ✓ (en lounges va el número).
            const mark = !section.round && (seat.taken || isSelected) ? (
              <text x={seat.x} y={seat.y + 3.5} textAnchor="middle" fontSize="10" fontWeight="900" fill={isSelected ? "#192438" : "#7D89A3"} pointerEvents="none" aria-hidden>
                {isSelected ? "✓" : "×"}
              </text>
            ) : null;
            const number = section.round && seat.short ? (
              <text x={seat.x} y={seat.y + 5} textAnchor="middle" fontSize="13" fontWeight="800" fill={isSelected ? "#192438" : seat.taken ? "#7D89A3" : "#F5F6F8"} pointerEvents="none">
                {seat.short}
              </text>
            ) : null;
            if (seat.taken) {
              return (
                <g key={seat.id} aria-hidden>
                  <Spot x={seat.x} y={seat.y} r={r} rect={rect} fill="#2A3751" />
                  {number}
                  {mark}
                </g>
              );
            }
            return (
              <g key={seat.id}>
              <Spot
                x={seat.x}
                y={seat.y}
                rect={rect}
                r={isSelected ? r + 2 : r}
                fill={isSelected ? "#F5B700" : section.round ? `${section.color}33` : "transparent"}
                stroke={isSelected ? "#F5B700" : section.color}
                strokeWidth={2}
                role="checkbox"
                aria-checked={isSelected}
                aria-label={`${section.name}, ${seat.label}`}
                tabIndex={0}
                className="cursor-pointer outline-none transition-[r] focus-visible:stroke-white"
                onClick={() => onToggle(section.ticketTypeId, seat.id)}
                onKeyDown={(e) => onKey(e, section.ticketTypeId, seat.id)}
              >
                <title>{`${section.name} · ${seat.label}`}</title>
              </Spot>
              {number}
              {mark}
              </g>
            );
          }),
        )}
      </svg>
      <div className="flex items-center justify-center gap-6 border-t border-[var(--border)] py-3 text-[10px] uppercase tracking-wide text-[var(--ink-dim)]">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-[var(--border-light)]" /> Libre
        </span>
        <span className="flex items-center gap-1.5">
          <span className="flex h-3 w-3 items-center justify-center rounded-full bg-[var(--highlight)] text-[8px] font-black text-[var(--highlight-ink)]">✓</span> Tu selección
        </span>
        <span className="flex items-center gap-1.5">
          <span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#2A3751] text-[9px] font-black text-[#7D89A3]">×</span> Ocupada
        </span>
        {zones.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-4 rounded-sm border border-[var(--border-light)] bg-white/10" /> Zona general: elige la cantidad abajo
          </span>
        )}
      </div>
    </div>
  );
}

/** Un lounge (círculo) o un reservado (rectángulo) con centro en (x, y). */
function Spot({ x, y, r, rect, children, ...rest }: { x: number; y: number; r: number; rect?: boolean } & Omit<SVGProps<SVGCircleElement>, "ref">) {
  if (!rect) {
    return (
      <circle cx={x} cy={y} r={r} {...rest}>
        {children}
      </circle>
    );
  }
  const { width, height } = reservadoSize(r);
  return (
    <rect x={x - width / 2} y={y - height / 2} width={width} height={height} rx={6} {...(rest as SVGProps<SVGRectElement>)}>
      {children}
    </rect>
  );
}
