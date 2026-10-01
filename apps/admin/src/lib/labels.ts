/** Etiquetas de estado del panel. */
export const EVENT_STATUS = {
  PUBLISHED: { text: "Publicado", className: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  DRAFT: { text: "Borrador", className: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  CANCELLED: { text: "Cancelado", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
} as const;

export const SEATING_LABEL = { GENERAL_ADMISSION: "Entrada general", RESERVED: "Butacas numeradas" } as const;
