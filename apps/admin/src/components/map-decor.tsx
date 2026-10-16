import { CANVAS_WIDTH, MAP_ITEM_COLOR, hasStage, type MapItem } from "@ticketera/core";

/**
 * Lo que no se vende del plano de un boliche (escenario, barras, DJ, entrada, baños, textos), dentro de un
 * <svg> del mismo lienzo. Si el plano no tiene escenario propio, dibuja el de siempre arriba al centro.
 */
export function MapDecor({ items = [] }: { items?: MapItem[] }) {
  return (
    <>
      {!hasStage(items) && (
        <>
          <rect x={CANVAS_WIDTH / 2 - 160} y={16} width={320} height={20} rx={4} fill="#1a1a18" />
          <text x={CANVAS_WIDTH / 2} y={30} textAnchor="middle" fontSize="10" letterSpacing="2" fill="#fff">
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
            fillOpacity={item.kind === "STAGE" ? 0.55 : 0.28}
            stroke={MAP_ITEM_COLOR[item.kind]}
            strokeWidth={1.5}
            strokeDasharray={item.kind === "LABEL" ? "6 4" : undefined}
          />
          <text
            x={item.x + item.width / 2}
            y={item.y + item.height / 2 + 5}
            textAnchor="middle"
            fontSize={Math.min(16, Math.max(10, item.height / 2.6))}
            fontWeight="700"
            letterSpacing="1"
            fill="#1a1a18"
          >
            {item.label.toUpperCase()}
          </text>
        </g>
      ))}
    </>
  );
}
