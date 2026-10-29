import { CANVAS_HEIGHT, CANVAS_WIDTH, reservadoSize, seatDotRadius, zoneLabelPoint, zonePath, type MapItem, type ZoneShape } from "@ticketera/core";
import { MapDecor } from "./map-decor";

export type PreviewSection = {
  id: string;
  name: string;
  color: string;
  /** En lounges en círculo, `label` es el número que va dentro del círculo. */
  seats: { x: number; y: number; label?: string }[];
  /** Lounges o mesas en círculo (cada "butaca" es una mesa): círculos más grandes con su número. */
  table?: { radius: number; shape?: "round" | "rect" } | null;
  /** Zona de entrada general dibujada como forma (en vez de butacas). */
  zone?: ZoneShape | null;
  /** Texto bajo el nombre de la zona (por ejemplo "Quedan 120"). */
  detail?: string;
  /** Atenuada: la sección no se vende en esta función. */
  muted?: boolean;
};

/** Solo las butacas con posición en el lienzo (las importadas sin plano no se dibujan). */
export function positioned(seats: { x: number | null; y: number | null }[]) {
  return seats.flatMap((s) => (s.x !== null && s.y !== null ? [{ x: s.x, y: s.y }] : []));
}

/** Mapa de butacas de solo lectura (mismo lienzo que el editor y que el sitio público). */
export function SeatMapPreview({ sections, items }: { sections: PreviewSection[]; items?: MapItem[] }) {
  return (
    <svg
      viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      className="w-full rounded-lg border border-[var(--border)]"
      style={{ background: "#fbfbf9" }}
      role="img"
      aria-label="Mapa de butacas"
    >
      <MapDecor items={items} />
      {sections.map((s) => (
        <g key={s.id} opacity={s.muted ? 0.25 : 1}>
          {s.zone && (
            <>
              <path d={zonePath(s.zone)} fill={s.color} fillOpacity={0.3} stroke={s.color} strokeWidth={2} />
              <text x={zoneLabelPoint(s.zone).x} y={zoneLabelPoint(s.zone).y} textAnchor="middle" fontSize="15" fontWeight="700" fill="#1a1a18">
                {s.name}
              </text>
              {s.detail && (
                <text x={zoneLabelPoint(s.zone).x} y={zoneLabelPoint(s.zone).y + 18} textAnchor="middle" fontSize="12" fill="#3f3f3a">
                  {s.detail}
                </text>
              )}
            </>
          )}
          {s.table
            ? s.seats.map((seat, i) => (
                <g key={i}>
                  {s.table!.shape === "rect" ? (
                    <rect
                      x={seat.x - reservadoSize(s.table!.radius).width / 2}
                      y={seat.y - reservadoSize(s.table!.radius).height / 2}
                      width={reservadoSize(s.table!.radius).width}
                      height={reservadoSize(s.table!.radius).height}
                      rx={6}
                      fill={s.color}
                      fillOpacity={0.4}
                      stroke={s.color}
                      strokeWidth={2}
                    />
                  ) : (
                    <circle cx={seat.x} cy={seat.y} r={s.table!.radius} fill={s.color} fillOpacity={0.4} stroke={s.color} strokeWidth={2} />
                  )}
                  {seat.label && (
                    <text x={seat.x} y={seat.y + 5} textAnchor="middle" fontSize="13" fontWeight="800" fill="#1a1a18">
                      {seat.label}
                    </text>
                  )}
                </g>
              ))
            : ((r) => s.seats.map((seat, i) => <circle key={i} cx={seat.x} cy={seat.y} r={r} fill={s.color} />))(seatDotRadius(s.seats, 6))}
        </g>
      ))}
    </svg>
  );
}
