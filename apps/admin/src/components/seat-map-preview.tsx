import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@ticketera/core";

export type PreviewSection = {
  id: string;
  name: string;
  color: string;
  seats: { x: number; y: number }[];
  /** Atenuada: la sección no se vende en esta función. */
  muted?: boolean;
};

/** Solo las butacas con posición en el lienzo (las importadas sin plano no se dibujan). */
export function positioned(seats: { x: number | null; y: number | null }[]) {
  return seats.flatMap((s) => (s.x !== null && s.y !== null ? [{ x: s.x, y: s.y }] : []));
}

/** Mapa de butacas de solo lectura (mismo lienzo que el editor y que el sitio público). */
export function SeatMapPreview({ sections }: { sections: PreviewSection[] }) {
  return (
    <svg
      viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      className="w-full rounded-lg border border-[var(--border)]"
      style={{ background: "#fbfbf9" }}
      role="img"
      aria-label="Mapa de butacas"
    >
      <rect x={CANVAS_WIDTH / 2 - 160} y={16} width={320} height={20} rx={4} fill="#1a1a18" />
      <text x={CANVAS_WIDTH / 2} y={30} textAnchor="middle" fontSize="10" letterSpacing="2" fill="#fff">
        ESCENARIO
      </text>
      {sections.map((s) => (
        <g key={s.id} opacity={s.muted ? 0.25 : 1}>
          {s.seats.map((seat, i) => (
            <circle key={i} cx={seat.x} cy={seat.y} r={6} fill={s.color} />
          ))}
        </g>
      ))}
    </svg>
  );
}
