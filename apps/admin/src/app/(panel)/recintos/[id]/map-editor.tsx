"use client";

/**
 * Mapa del recinto: un solo lugar para dibujar todo. Se elige qué agregar:
 *  - Con butacas: secciones numeradas (grilla o arco), cada butaca se elige al comprar.
 *  - Sin butacas: zonas de entrada general (rectángulo, óvalo, trapecio o arco) con su aforo.
 *  - Puertas: dónde están las entradas, con nombre, y qué secciones entran por cada una.
 * Las tres pestañas dibujan el MISMO mapa completo; solo cambia lo que se está editando.
 */
import { useState } from "react";
import type { GatePoint, ZoneShape } from "@ticketera/core";
import { GateDesigner, type DesignerGate } from "./gate-designer";
import { SeatDesigner, type DesignerSection } from "./seat-designer";
import { ZoneDesigner, type DesignerZone } from "./zone-designer";

type Tab = "seats" | "zones" | "gates";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "seats", label: "Con butacas", hint: "Secciones numeradas: el comprador elige su butaca en el mapa." },
  { id: "zones", label: "Sin butacas", hint: "Zonas de entrada general: una forma con su aforo; el comprador elige cuántas entradas." },
  { id: "gates", label: "Puertas", hint: "Dónde están las entradas, con nombre, y qué secciones entran por cada una." },
];

export type MapEditorProps = {
  venueId: string;
  seated: DesignerSection[];
  zones: DesignerZone[];
  /** Todas las zonas con su forma: la guardada, o la colocada automáticamente si todavía no tienen. */
  resolvedZones: { id: string; name: string; color: string; shape: ZoneShape; auto: boolean }[];
  gates: DesignerGate[];
  /** Puertas con su lugar en el mapa (las sin ubicar, al borde de abajo). */
  gateMarkers: (GatePoint & { auto?: boolean })[];
  seats: { x: number; y: number; color: string }[];
  sections: { id: string; name: string; color: string }[];
};

export function MapEditor(props: MapEditorProps) {
  const [tab, setTab] = useState<Tab>("seats");
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Qué agregar al mapa" className="inline-flex gap-1 rounded-lg bg-[var(--surface-2)] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="mapa-panel"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-2 text-sm transition-colors ${tab === t.id ? "bg-[var(--surface)] font-semibold shadow-sm" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-[var(--ink-muted)]">{current.hint}</p>

      <div role="tabpanel" id="mapa-panel" aria-labelledby={`tab-${tab}`}>
        {tab === "seats" && (
          <SeatDesigner
            venueId={props.venueId}
            existingSections={props.seated}
            zones={props.resolvedZones.map((z) => ({ id: z.id, name: z.name, color: z.color, layout: z.shape }))}
            gates={props.gateMarkers}
          />
        )}
        {tab === "zones" && (
          <ZoneDesigner
            venueId={props.venueId}
            zones={props.zones}
            seats={props.seats}
            autoShapes={Object.fromEntries(props.resolvedZones.filter((z) => z.auto).map((z) => [z.id, z.shape]))}
            gates={props.gateMarkers}
          />
        )}
        {tab === "gates" && (
          <GateDesigner
            venueId={props.venueId}
            gates={props.gates}
            sections={props.sections}
            zones={props.resolvedZones.map((z) => ({ id: z.id, name: z.name, color: z.color, shape: z.shape }))}
            seats={props.seats}
          />
        )}
      </div>
    </div>
  );
}
