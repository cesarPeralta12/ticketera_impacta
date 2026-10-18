/**
 * Plantillas de recinto: un punto de partida armado (secciones, zonas, mesas, plano y puertas) para no empezar el
 * mapa de cero. Se crean como un recinto normal: después se edita todo como siempre.
 * Puro (sin DOM): lo usan la acción que crea el recinto, las miniaturas y las pruebas.
 */
import type { MapItem } from "./club-map";
import { computeSeatPositions, type SectionShape } from "./seat-geometry";
import { seatedTableSeats, type SeatedTablesLayout } from "./seated-tables";
import type { ZoneShape } from "./zone-geometry";

export type TemplateSection =
  | { kind: "zone"; name: string; color: string; capacity: number; zone: ZoneShape }
  | { kind: "seats"; name: string; color: string; shape: SectionShape }
  | { kind: "lounges"; name: string; color: string; prefix: string; shape: "round" | "rect"; tables: { number: number; x: number; y: number }[] }
  | { kind: "seated"; name: string; color: string; layout: SeatedTablesLayout };

export type VenueTemplate = {
  key: "boliche" | "teatro" | "salon" | "aire-libre";
  label: string;
  description: string;
  items: MapItem[];
  sections: TemplateSection[];
  /** Zonas de acceso (para reingreso y aforo en vivo por zona). */
  accessZones: { name: string; level: number; color: string }[];
  /** Puertas: dirección y zona a la que dan (por nombre). */
  gates: { name: string; direction: "IN" | "OUT" | "BOTH"; zone?: string }[];
};

const item = (id: string, kind: MapItem["kind"], label: string, x: number, y: number, width: number, height: number): MapItem => ({
  id,
  kind,
  label,
  x,
  y,
  width,
  height,
});

export const VENUE_TEMPLATES: VenueTemplate[] = [
  {
    key: "boliche",
    label: "Boliche",
    description: "Pista, VIP, 4 reservados, DJ, dos barras, baños y entrada.",
    items: [
      item("dj", "DJ", "DJ", 455, 30, 90, 56),
      item("barra-1", "BAR", "Barra", 30, 230, 44, 220),
      item("barra-2", "BAR", "Barra VIP", 926, 340, 44, 200),
      item("banos", "BATHROOM", "Baños", 30, 560, 90, 50),
      item("entrada", "ENTRANCE", "Entrada", 445, 596, 110, 36),
    ],
    sections: [
      { kind: "zone", name: "Pista", color: "#35C48F", capacity: 300, zone: { type: "zone", shape: "rect", x: 300, y: 120, width: 400, height: 300 } },
      { kind: "zone", name: "VIP", color: "#C04BFF", capacity: 60, zone: { type: "zone", shape: "rect", x: 730, y: 110, width: 180, height: 200 } },
      {
        kind: "lounges",
        name: "Reservados",
        color: "#FF7A3D",
        prefix: "Reservado",
        shape: "rect",
        tables: [
          { number: 1, x: 150, y: 140 },
          { number: 2, x: 150, y: 230 },
          { number: 3, x: 150, y: 320 },
          { number: 4, x: 150, y: 410 },
        ],
      },
    ],
    accessZones: [
      { name: "General", level: 1, color: "#35C48F" },
      { name: "VIP", level: 2, color: "#C04BFF" },
    ],
    gates: [
      { name: "Puerta principal", direction: "IN", zone: "General" },
      { name: "Acceso VIP", direction: "IN", zone: "VIP" },
      { name: "Salida", direction: "OUT" },
    ],
  },
  {
    key: "teatro",
    label: "Teatro",
    description: "Escenario, platea de 12 filas y balcón en arco: butacas numeradas.",
    items: [item("escenario", "STAGE", "Escenario", 340, 24, 320, 56)],
    sections: [
      { kind: "seats", name: "Platea", color: "#F5B700", shape: { type: "grid", rows: 12, seatsPerRow: 24, x: 213, y: 120, seatGap: 25, rowGap: 24 } },
      {
        kind: "seats",
        name: "Balcón",
        color: "#4EA1FF",
        shape: { type: "arc", rows: 4, seatsPerRow: 26, centerX: 500, centerY: 60, startRadius: 420, rowGap: 24, startAngleDeg: 60, spanDeg: 60 },
      },
    ],
    accessZones: [],
    gates: [{ name: "Puerta principal", direction: "IN" }],
  },
  {
    key: "salon",
    label: "Salón de eventos",
    description: "12 mesas redondas de 8 (se venden completas), pista de baile, escenario y barra.",
    items: [
      item("escenario", "STAGE", "Escenario", 740, 36, 190, 56),
      item("barra", "BAR", "Barra", 60, 566, 220, 44),
      item("entrada", "ENTRANCE", "Entrada", 445, 596, 110, 36),
    ],
    sections: [
      {
        kind: "seated",
        name: "Mesas",
        color: "#B98CFF",
        layout: {
          type: "seated",
          prefix: "Mesa",
          shape: "round",
          chairs: 8,
          mode: "WHOLE",
          min: 8,
          max: 8,
          size: 22,
          tables: Array.from({ length: 12 }, (_, i) => ({ number: i + 1, x: 140 + (i % 4) * 140, y: 150 + Math.floor(i / 4) * 140 })),
        },
      },
      { kind: "zone", name: "Pista de baile", color: "#35C48F", capacity: 120, zone: { type: "zone", shape: "rect", x: 720, y: 140, width: 230, height: 320 } },
    ],
    accessZones: [],
    gates: [{ name: "Puerta principal", direction: "IN" }],
  },
  {
    key: "aire-libre",
    label: "Aire libre",
    description: "Festival o concierto al aire libre: VIP, Preferencial y General de pie, escenario, barras y baños.",
    items: [
      item("escenario", "STAGE", "Escenario", 340, 24, 320, 60),
      item("barra-1", "BAR", "Barra", 30, 300, 44, 200),
      item("barra-2", "BAR", "Barra", 926, 300, 44, 200),
      item("banos", "BATHROOM", "Baños", 30, 560, 90, 50),
      item("entrada", "ENTRANCE", "Entrada", 445, 596, 110, 36),
    ],
    sections: [
      { kind: "zone", name: "VIP", color: "#C04BFF", capacity: 300, zone: { type: "zone", shape: "rect", x: 350, y: 110, width: 300, height: 110 } },
      {
        kind: "zone",
        name: "Preferencial",
        color: "#F5B700",
        capacity: 1500,
        zone: { type: "zone", shape: "trapezoid", x: 250, y: 240, width: 500, height: 150, taper: 0.2 },
      },
      { kind: "zone", name: "General", color: "#35C48F", capacity: 5000, zone: { type: "zone", shape: "rect", x: 120, y: 410, width: 760, height: 170 } },
    ],
    accessZones: [
      { name: "General", level: 1, color: "#35C48F" },
      { name: "Preferencial", level: 2, color: "#F5B700" },
      { name: "VIP", level: 3, color: "#C04BFF" },
    ],
    gates: [
      { name: "Puerta General", direction: "IN", zone: "General" },
      { name: "Acceso Preferencial", direction: "IN", zone: "Preferencial" },
      { name: "Acceso VIP", direction: "IN", zone: "VIP" },
      { name: "Salida", direction: "OUT" },
    ],
  },
];

export function venueTemplate(key: string): VenueTemplate | undefined {
  return VENUE_TEMPLATES.find((t) => t.key === key);
}

/** Butacas de una sección de plantilla (en zonas generales, ninguna). */
export function templateSectionSeats(section: TemplateSection): { row: string; number: string; label: string; x: number; y: number }[] {
  if (section.kind === "seats") return computeSeatPositions(section.shape).map((p) => ({ ...p, label: `Fila ${p.row} · ${p.number}` }));
  if (section.kind === "lounges") return section.tables.map((t) => ({ row: "L", number: String(t.number), label: `${section.prefix} ${t.number}`, x: t.x, y: t.y }));
  if (section.kind === "seated") return seatedTableSeats(section.layout);
  return [];
}

/** Aforo de la plantilla: personas de pie + butacas, sillas y reservados. */
export function templateCapacity(template: VenueTemplate): number {
  return template.sections.reduce((sum, s) => sum + (s.kind === "zone" ? s.capacity : templateSectionSeats(s).length), 0);
}
