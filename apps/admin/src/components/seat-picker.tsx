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
  seats: PickerSeat[];
};

/**
 * Mapa de butacas para la boletería (el mismo dibujo que ve el comprador en la web, en el
 * tema claro del panel). Elegir no bloquea: la butaca se reserva al cobrar, de forma atómica.
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
  const labels = sections.map((s) => {
    const xs = s.seats.map((seat) => seat.x);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const midX = (minX + maxX) / 2;
    const tolerance = Math.max(15, (maxX - minX) * 0.05);
    const middle = s.seats.filter((seat) => Math.abs(seat.x - midX) <= tolerance);
    const y = Math.min(...(middle.length ? middle : s.seats).map((seat) => seat.y));
    // Nombre, precio y butacas libres sobre el total, encima de la sección.
    const free = s.seats.filter((seat) => !seat.taken).length;
    const price = `${s.presale ? "PREVENTA " : ""}${formatMoney(s.unitAmount, s.currency)}`;
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
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <svg
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        className="w-full min-w-[640px] select-none"
        role="group"
        aria-label="Mapa de butacas"
      >
        <rect x={CANVAS_WIDTH / 2 - 160} y={18} width={320} height={16} rx={8} fill="#e1dfd7" />
        <text x={CANVAS_WIDTH / 2} y={56} textAnchor="middle" fontSize="11" letterSpacing="4" fill="#9a9c92">
          ESCENARIO
        </text>
        {labels.map((l) => (
          <g key={l.name}>
            <text x={l.x} y={l.y} textAnchor="middle" fontSize="15" fontWeight="700" fill={l.color}>
              {l.name.toUpperCase()}
            </text>
            <text x={l.x} y={l.y + 18} textAnchor="middle" fontSize="14" fontWeight="600" fill="#62655f">
              {l.detail}
            </text>
          </g>
        ))}
        {sections.map((section) =>
          section.seats.map((seat) => {
            const isSelected = selected.has(seat.id);
            if (seat.taken) {
              return <circle key={seat.id} cx={seat.x} cy={seat.y} r={7} fill="#d4d2c9" aria-hidden />;
            }
            return (
              <circle
                key={seat.id}
                cx={seat.x}
                cy={seat.y}
                r={isSelected ? 9 : 7}
                fill={isSelected ? "#14181b" : "#ffffff"}
                stroke={isSelected ? "#14181b" : section.color}
                strokeWidth={2}
                role="checkbox"
                aria-checked={isSelected}
                aria-label={`${section.name}, ${seat.label}`}
                tabIndex={0}
                className="cursor-pointer outline-none focus-visible:stroke-[#0f8a6b]"
                onClick={() => onToggle(section.ticketTypeId, seat.id)}
                onKeyDown={(e) => onKey(e, section.ticketTypeId, seat.id)}
              >
                <title>{`${section.name} · ${seat.label}`}</title>
              </circle>
            );
          }),
        )}
      </svg>
      <div className="flex items-center justify-center gap-6 border-t border-[var(--border)] py-2 text-[10px] uppercase tracking-wide text-[var(--ink-dim)]">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-[var(--ink-dim)] bg-white" /> Libre
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[var(--ink)]" /> Elegida
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#d4d2c9]" /> Vendida
        </span>
      </div>
    </div>
  );
}
