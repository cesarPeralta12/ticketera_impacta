/**
 * Por qué puerta debe ingresar una entrada. Es la misma regla que aplica la puerta al leerla:
 * una puerta con secciones asignadas solo acepta entradas de esas secciones; una puerta sin secciones
 * asignadas acepta todas.
 */

export type GateInfo = { name: string; sectionIds: string[] };

export type Entrance =
  /** El recinto no tiene puertas cargadas (o ninguna recibe esta sección): no se dice nada. */
  | { kind: "none" }
  /** Cualquiera de las puertas del recinto (hay varias y todas la aceptan). */
  | { kind: "any" }
  | { kind: "gates"; names: string[] };

export function entranceFor(gates: GateInfo[], sectionId: string | null): Entrance {
  if (gates.length === 0) return { kind: "none" };
  const allowed = gates.filter((g) => g.sectionIds.length === 0 || (sectionId !== null && g.sectionIds.includes(sectionId)));
  if (allowed.length === 0) return { kind: "none" };
  if (allowed.length === gates.length && gates.length > 1) return { kind: "any" };
  return { kind: "gates", names: allowed.map((g) => g.name) };
}

/** Texto para mostrar en la entrada y en el correo, o null si no hay nada que decir. */
export function entranceLabel(entrance: Entrance): string | null {
  if (entrance.kind === "none") return null;
  if (entrance.kind === "any") return "Ingreso por cualquier puerta";
  const [first, ...rest] = entrance.names;
  if (rest.length === 0) return `Ingreso por: ${first}`;
  const last = rest.pop()!;
  return `Ingreso por: ${[first, ...rest].join(", ")} o ${last}`;
}

/** Atajo: el texto directo a partir de las puertas del recinto y la sección de la entrada. */
export const entranceText = (gates: GateInfo[], sectionId: string | null) => entranceLabel(entranceFor(gates, sectionId));
