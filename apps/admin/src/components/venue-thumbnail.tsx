import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAP_ITEM_COLOR,
  TABLE_RADIUS,
  isSeatedTablesLayout,
  isTablesLayout,
  isZoneLayout,
  mapItemsOf,
  zonePath,
  type MapItem,
  type ZoneShape,
} from "@ticketera/core";

export type ThumbnailData = {
  items: MapItem[];
  zones: { zone: ZoneShape; color: string }[];
  /** Butacas, sillas, mesas y lounges: un punto (o un círculo más grande si `r`). */
  seats: { x: number; y: number; color: string; r?: number }[];
};

type ThumbnailVenue = {
  mapItems: unknown;
  sections: { color: string; layout: unknown; seats: { x: number | null; y: number | null }[] }[];
};

/**
 * Datos de la miniatura de un recinto: el plano, las zonas y sus butacas, sillas y lounges. Con `maxSeats` se dibuja
 * una de cada tantas butacas (en una miniatura no se nota y pesa menos cuando hay muchos recintos juntos).
 */
export function thumbnailOf(venue: ThumbnailVenue, maxSeats = Infinity): ThumbnailData {
  const seats = venue.sections.flatMap((s) =>
    s.seats.flatMap((seat) =>
      seat.x !== null && seat.y !== null
        ? [{ x: seat.x, y: seat.y, color: s.color, r: isTablesLayout(s.layout) ? TABLE_RADIUS : isSeatedTablesLayout(s.layout) ? 5 : undefined }]
        : [],
    ),
  );
  const every = Math.max(1, Math.ceil(seats.length / maxSeats));
  return {
    items: mapItemsOf(venue.mapItems),
    zones: venue.sections.flatMap((s) => (isZoneLayout(s.layout) ? [{ zone: s.layout, color: s.color }] : [])),
    seats: every === 1 ? seats : seats.filter((_, i) => i % every === 0),
  };
}

/** Miniatura del mapa de un recinto (o de una plantilla): zonas, butacas y el plano, sin textos. */
export function VenueThumbnail({ data, className = "" }: { data: ThumbnailData; className?: string }) {
  return (
    <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} className={`w-full rounded-md border border-[var(--border)] ${className}`} style={{ background: "#fbfbf9" }} aria-hidden>
      {data.items.map((i) => (
        <rect key={i.id} x={i.x} y={i.y} width={i.width} height={i.height} rx={8} fill={MAP_ITEM_COLOR[i.kind]} fillOpacity={0.35} />
      ))}
      {data.zones.map((z, i) => (
        <path key={i} d={zonePath(z.zone)} fill={z.color} fillOpacity={0.35} stroke={z.color} strokeWidth={4} />
      ))}
      {data.seats.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r ?? 7} fill={s.color} fillOpacity={s.r ? 0.5 : 0.9} />
      ))}
    </svg>
  );
}
