import { gateLabelWidth, type GatePoint } from "@ticketera/core";

/**
 * Puertas dibujadas sobre el mapa (SVG): una píldora oscura con un punto verde y el nombre, en el lugar donde
 * está la entrada. `pointer-events` apagado: en los mapas de solo lectura no estorban; el editor de puertas
 * dibuja las suyas aparte.
 */
export function GateMarkers({ gates, dim = false }: { gates: (GatePoint & { auto?: boolean })[]; dim?: boolean }) {
  return (
    <g style={{ pointerEvents: "none" }} opacity={dim ? 0.55 : 1}>
      {gates.map((g) => {
        const w = gateLabelWidth(g.name);
        return (
          <g key={g.id} transform={`translate(${g.x} ${g.y})`}>
            <title>{`Puerta: ${g.name}${g.auto ? " (sin ubicar en el mapa)" : ""}`}</title>
            <rect x={-w / 2} y={-13} width={w} height={26} rx={13} fill="#1a1a18" stroke={g.auto ? "#9a9a92" : "#0f8a6b"} strokeWidth={2} strokeDasharray={g.auto ? "4 3" : undefined} />
            <circle cx={-w / 2 + 14} cy={0} r={5} fill={g.auto ? "#9a9a92" : "#35c48f"} />
            <text x={-w / 2 + 25} y={4.5} fontSize="12.5" fontWeight="700" fill="#fff">
              {g.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}
