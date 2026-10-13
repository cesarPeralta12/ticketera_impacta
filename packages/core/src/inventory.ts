/**
 * Disponibilidad de entradas (cálculo puro, sin base de datos).
 *
 * Una entrada está "comprometida" si pertenece a una orden pagada o a una orden
 * pendiente cuya reserva no venció. Hay dos límites que se cumplen a la vez:
 *  - el cupo de cada tipo de entrada (ej. Preventa: 500), y
 *  - el aforo de la sección física, compartido entre tipos (ej. Cancha: 2.000 entre
 *    Preventa y General).
 * Una mesa se cuenta como una unidad en su cupo (10 mesas) pero ocupa en la sección los lugares de
 * todas sus personas (una mesa de 6 son 6 personas del aforo).
 */

export type InventoryLine = {
  ticketTypeId: string;
  name: string;
  capacity: number;
  used: number;
  sectionId: string | null;
  sectionCapacity: number | null;
  /** Personas por unidad (mesa de 6 → 6). Sin dato: 1. */
  peoplePerUnit?: number;
};

const people = (line: InventoryLine) => Math.max(1, line.peoplePerUnit ?? 1);

export type RequestedLine = { ticketTypeId: string; quantity: number };

export type Shortage = { ticketTypeId: string; name: string; available: number };

function sectionUsage(lines: InventoryLine[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const line of lines) {
    if (line.sectionId) usage.set(line.sectionId, (usage.get(line.sectionId) ?? 0) + line.used * people(line));
  }
  return usage;
}

/** Entradas que todavía se pueden vender de cada tipo, considerando ambos límites. */
export function remainingByType(lines: InventoryLine[]): Map<string, number> {
  const usedBySection = sectionUsage(lines);
  const remaining = new Map<string, number>();
  for (const line of lines) {
    let left = line.capacity - line.used;
    if (line.sectionId && line.sectionCapacity !== null) {
      left = Math.min(left, Math.floor((line.sectionCapacity - (usedBySection.get(line.sectionId) ?? 0)) / people(line)));
    }
    remaining.set(line.ticketTypeId, Math.max(0, left));
  }
  return remaining;
}

/**
 * Cuántas entradas se pueden vender en total en una función. No es la suma de los cupos:
 * Preventa (300) + General (800) sobre una Cancha de 800 suman 800, no 1.100.
 */
export function sellableCapacity(
  types: { capacity: number; sectionId: string | null; section: { capacity: number } | null; peoplePerUnit?: number }[],
): number {
  const bySection = new Map<string, { cap: number; sum: number }>();
  let unsectioned = 0;
  for (const t of types) {
    // En personas: 10 mesas de 6 son 60 lugares.
    const seats = t.capacity * Math.max(1, t.peoplePerUnit ?? 1);
    if (!t.sectionId || !t.section) {
      unsectioned += seats;
      continue;
    }
    const entry = bySection.get(t.sectionId) ?? { cap: t.section.capacity, sum: 0 };
    entry.sum += seats;
    bySection.set(t.sectionId, entry);
  }
  return unsectioned + [...bySection.values()].reduce((total, s) => total + Math.min(s.cap, s.sum), 0);
}

/**
 * Devuelve el primer tipo de entrada que no alcanza para el pedido, o null si todo cabe.
 * Considera el pedido completo: 300 Preventa + 300 General no pueden superar juntos
 * lo que queda en la Cancha.
 */
export function findShortage(lines: InventoryLine[], requestedLines: RequestedLine[]): Shortage | null {
  const byId = new Map(lines.map((l) => [l.ticketTypeId, l]));
  // Agrupa por tipo: una compra de 3 butacas trae 3 líneas del mismo tipo de entrada.
  const totals = new Map<string, number>();
  for (const r of requestedLines) totals.set(r.ticketTypeId, (totals.get(r.ticketTypeId) ?? 0) + r.quantity);
  const requested = [...totals].map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));
  const usedBySection = sectionUsage(lines);
  const requestedBySection = new Map<string, number>();

  for (const req of requested) {
    const line = byId.get(req.ticketTypeId);
    if (!line) return { ticketTypeId: req.ticketTypeId, name: "?", available: 0 };
    if (line.used + req.quantity > line.capacity) {
      return { ticketTypeId: line.ticketTypeId, name: line.name, available: Math.max(0, line.capacity - line.used) };
    }
    if (line.sectionId) {
      requestedBySection.set(line.sectionId, (requestedBySection.get(line.sectionId) ?? 0) + req.quantity * people(line));
    }
  }

  for (const req of requested) {
    const line = byId.get(req.ticketTypeId)!;
    if (!line.sectionId || line.sectionCapacity === null) continue;
    const used = usedBySection.get(line.sectionId) ?? 0;
    const wanted = requestedBySection.get(line.sectionId) ?? 0;
    if (used + wanted > line.sectionCapacity) {
      return {
        ticketTypeId: line.ticketTypeId,
        name: line.name,
        available: Math.max(0, Math.min(line.capacity - line.used, Math.floor((line.sectionCapacity - used) / people(line)))),
      };
    }
  }
  return null;
}
