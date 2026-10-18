import { describe, expect, it } from "vitest";
import { TABLE_RADIUS, parseMapItems, parseTables } from "./club-map";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./seat-geometry";
import { parseSeatedTablesLayout } from "./seated-tables";
import { VENUE_TEMPLATES, templateCapacity, templateSectionSeats } from "./venue-templates";
import { parseZoneLayout, zonesOverlap, type ZoneShape } from "./zone-geometry";

describe("plantillas de recinto", () => {
  it("hay boliche, teatro, salón y aire libre", () => {
    expect(VENUE_TEMPLATES.map((t) => t.key)).toEqual(["boliche", "teatro", "salon", "aire-libre"]);
  });

  for (const template of VENUE_TEMPLATES) {
    it(`${template.label}: todo es válido y entra en el mapa`, () => {
      expect(parseMapItems(template.items)).toHaveLength(template.items.length);
      const zones: ZoneShape[] = [];
      for (const section of template.sections) {
        if (section.kind === "zone") {
          expect(parseZoneLayout(section.zone).ok).toBe(true);
          zones.push(section.zone);
        }
        if (section.kind === "lounges") expect(parseTables(section.tables, TABLE_RADIUS).ok).toBe(true);
        if (section.kind === "seated") expect(parseSeatedTablesLayout(section.layout)).toMatchObject({ ok: true });
        for (const seat of templateSectionSeats(section)) {
          expect(seat.x).toBeGreaterThan(0);
          expect(seat.x).toBeLessThan(CANVAS_WIDTH);
          expect(seat.y).toBeGreaterThan(0);
          expect(seat.y).toBeLessThan(CANVAS_HEIGHT);
        }
      }
      for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) expect(zonesOverlap(zones[i]!, zones[j]!)).toBe(false);
      // Las puertas apuntan a zonas de acceso que existen.
      for (const gate of template.gates) if (gate.zone) expect(template.accessZones.map((z) => z.name)).toContain(gate.zone);
      expect(templateCapacity(template)).toBeGreaterThan(0);
    });
  }
});
