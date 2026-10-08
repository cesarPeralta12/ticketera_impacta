/** Etiquetas de estado del panel. */
export const EVENT_STATUS = {
  PUBLISHED: { text: "Publicado", className: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  DRAFT: { text: "Borrador", className: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  CANCELLED: { text: "Cancelado", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
} as const;

export const SEATING_LABEL = { GENERAL_ADMISSION: "Entrada general", RESERVED: "Butacas numeradas" } as const;

export const ROLE_LABEL = {
  OWNER: "Dueño",
  ADMIN: "Administrador",
  OPERATOR: "Operador de puerta",
  CASHIER: "Cajero (boletería)",
  CLIENT: "Cliente / organizador",
} as const;

export const MODE_LABEL = { TICKETING: "Venta de entradas", GUEST_LIST: "Lista de invitados" } as const;

export const CHANNEL_LABEL = { ONLINE: "Online", POS: "Boletería", GUEST: "Invitaciones" } as const;

export const SCAN_LABEL = {
  ACCEPTED: "Aceptada",
  ALREADY_USED: "Ya usada",
  NOT_FOUND: "No existe",
  CANCELLED: "Anulada",
  WRONG_SESSION: "Otra función",
  WRONG_GATE: "Puerta equivocada",
  INVALID: "Código inválido",
  METHOD_NOT_ALLOWED: "Método no permitido",
} as const;

export const ACCESS_METHOD_LABEL = { QR: "QR", BARCODE: "Código de barras", NFC: "NFC" } as const;

export const TICKET_STATUS = {
  VALID: { text: "Válida", className: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  USED: { text: "Ingresó", className: "bg-[var(--surface-2)] text-[var(--ink)]" },
  CANCELLED: { text: "Anulada", className: "bg-[var(--danger-soft)] text-[var(--danger)]" },
} as const;
