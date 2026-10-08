"use client";

import type { KeyboardEvent } from "react";
import { CANVAS_HEIGHT, CANVAS_WIDTH, formatMoney } from "@ticketera/core";

export type PickerSeat = { id: string; label: string; x: number; y: number; taken: boolean };
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
}: {
  sections: PickerSection[];
  selected: Set<string>;
  onToggle: (ticketTypeId: string, seatId: string) => void;
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
            <stop offset="0" stopColor="#f5b700" stopOpacity="0" />
            <stop offset="0.5" stopColor="#f5b700" stopOpacity="0.7" />
            <stop offset="1" stopColor="#f5b700" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x={CANVAS_WIDTH / 2 - 160} y={18} width={320} height={16} rx={8} fill="url(#escenario)" />
        <text x={CANVAS_WIDTH / 2} y={56} textAnchor="middle" fontSize="11" letterSpacing="4" fill="#6b687a">
          ESCENARIO
        </text>

        {labels.map((l) => (
          <g key={l.name}>
            <text x={l.x} y={l.y} textAnchor="middle" fontSize="15" fontWeight="700" fill={l.color}>
              {l.name.toUpperCase()}
            </text>
            <text x={l.x} y={l.y + 18} textAnchor="middle" fontSize="14" fontWeight="600" fill="#c9c6d6">
              {l.detail}
            </text>
          </g>
        ))}

        {sections.map((section) =>
          section.seats.map((seat) => {
            const isSelected = selected.has(seat.id);
            if (seat.taken) {
              return <circle key={seat.id} cx={seat.x} cy={seat.y} r={7} fill="#2a2a36" aria-hidden />;
            }
            return (
              <circle
                key={seat.id}
                cx={seat.x}
                cy={seat.y}
                r={isSelected ? 9 : 7}
                fill={isSelected ? "#f5b700" : "transparent"}
                stroke={isSelected ? "#f5b700" : section.color}
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
              </circle>
            );
          }),
        )}
      </svg>
      <div className="flex items-center justify-center gap-6 border-t border-[var(--border)] py-3 text-[10px] uppercase tracking-wide text-[var(--ink-dim)]">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-[var(--border-light)]" /> Libre
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[var(--accent)]" /> Tu selección
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#2a2a36]" /> Ocupada
        </span>
      </div>
    </div>
  );
}
