/**
 * Por qué puerta debe ingresar una entrada. Es la misma regla que aplica la puerta al leerla:
 * una puerta con secciones asignadas solo acepta entradas de esas secciones; una puerta sin secciones
 * asignadas acepta todas. Las puertas de salida no son un ingreso, y una puerta que da a una zona (VIP)
 * solo acepta las entradas que abren esa zona (las que no dicen zonas entran por las de siempre).
 */

export type GateInfo = { name: string; sectionIds: string[]; direction?: "IN" | "OUT" | "BOTH"; zoneId?: string | null };

/** Una puerta del recinto tal como la trae la base (con sus secciones) a `GateInfo`. */
export const gateInfo = (g: { name: string; sections: { id: string }[]; direction?: GateInfo["direction"]; zoneId?: string | null }): GateInfo => ({
  name: g.name,
  sectionIds: g.sections.map((s) => s.id),
  direction: g.direction,
  zoneId: g.zoneId ?? null,
});

export type Entrance =
  /** El recinto no tiene puertas cargadas (o ninguna recibe esta sección): no se dice nada. */
  | { kind: "none" }
  /** Cualquiera de las puertas del recinto (hay varias y todas la aceptan). */
  | { kind: "any" }
  | { kind: "gates"; names: string[] };

export function entranceFor(gates: GateInfo[], sectionId: string | null, zoneIds: string[] = []): Entrance {
  const entries = gates.filter((g) => g.direction !== "OUT");
  if (entries.length === 0) return { kind: "none" };
  const allowed = entries.filter(
    (g) =>
      (g.sectionIds.length === 0 || (sectionId !== null && g.sectionIds.includes(sectionId))) &&
      (!g.zoneId || zoneIds.length === 0 || zoneIds.includes(g.zoneId)),
  );
  if (allowed.length === 0) return { kind: "none" };
  if (allowed.length === entries.length && entries.length > 1) return { kind: "any" };
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
export const entranceText = (gates: GateInfo[], sectionId: string | null, zoneIds?: string[]) =>
  entranceLabel(entranceFor(gates, sectionId, zoneIds));

/** "Permite salir y volver a entrar (hasta 3 ingresos)" para las entradas con reingreso; null para las de un ingreso. */
export function reentryText(maxEntries: number | undefined): string | null {
  if (maxEntries === undefined || maxEntries === 1) return null;
  return maxEntries === 0 ? "Permite salir y volver a entrar" : `Permite salir y volver a entrar (hasta ${maxEntries} ingresos)`;
}
