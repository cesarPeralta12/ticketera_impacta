import { isSeatedTablesLayout, isTablesLayout } from "@ticketera/core";

/** Etiquetas de estado del panel. */
export const EVENT_STATUS = {
  PUBLISHED: { text: "Publicado", className: "bg-[var(--success-soft)] text-[var(--success)]" },
  PENDING_REVIEW: { text: "En revisión", className: "bg-[var(--info-soft)] text-[var(--info)]" },
  DRAFT: { text: "Borrador", className: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  CANCELLED: { text: "Cancelado", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
} as const;

export const SEATING_LABEL = { GENERAL_ADMISSION: "Entrada general", RESERVED: "Butacas numeradas" } as const;

/** Tipo de sección para mostrar: los lounges del boliche y las mesas con sillas son numerados pero no son butacas. */
export function seatingLabel(section: { seatingMode: keyof typeof SEATING_LABEL; layout: unknown }): string {
  if (isTablesLayout(section.layout)) return "Lounges en el plano";
  if (isSeatedTablesLayout(section.layout)) return `Mesas con sillas · ${section.layout.tables.length} mesas`;
  return SEATING_LABEL[section.seatingMode];
}

export const ROLE_LABEL = {
  OWNER: "Dueño",
  ADMIN: "Administrador",
  OPERATOR: "Operador de puerta",
  CASHIER: "Cajero (boletería y barra)",
  CLIENT: "Cliente (solo lectura)",
  PROMOTER: "Promotor (vende con QR)",
} as const;

export const MODE_LABEL = { TICKETING: "Venta de entradas", GUEST_LIST: "Lista de invitados" } as const;

export const CHANNEL_LABEL = { ONLINE: "Online", POS: "Boletería", GUEST: "Invitaciones", PRINTED: "Impresas", IMPORT: "Importadas", PROMOTER: "Promotores" } as const;

export const SCAN_LABEL = {
  ACCEPTED: "Aceptada",
  ALREADY_USED: "Ya usada",
  NOT_FOUND: "No existe",
  CANCELLED: "Anulada",
  WRONG_SESSION: "Otra función",
  WRONG_GATE: "Puerta equivocada",
  INVALID: "Código inválido",
  METHOD_NOT_ALLOWED: "Método no permitido",
  QR_EXPIRED: "QR vencido (captura)",
  STATIC_NOT_ALLOWED: "Exige QR dinámico",
  OUT_OF_HOURS: "Fuera de horario",
  NOT_ACTIVATED: "Impresa sin vender (no activada)",
  NOT_INSIDE: "Salida sin haber entrado",
  ZONE_FULL: "Zona llena",
} as const;

/** Qué hizo una lectura aceptada (ver PresenceMovement). Vacío en las lecturas de antes de las zonas: ingreso. */
export const MOVEMENT_LABEL = {
  ENTRY: "Ingreso",
  REENTRY: "Reingreso",
  EXIT: "Salida",
  ZONE_CHANGE: "Cambio de zona",
  MANUAL: "Corrección manual",
} as const;

export const DIRECTION_LABEL = { IN: "Entrada", OUT: "Salida", BOTH: "Entrada y salida" } as const;

export const ACCESS_METHOD_LABEL = { QR: "QR", BARCODE: "Código de barras", NFC: "NFC" } as const;

export const TICKET_STATUS = {
  VALID: { text: "Válida", className: "bg-[var(--success-soft)] text-[var(--success)]" },
  USED: { text: "Ingresó", className: "bg-[var(--surface-2)] text-[var(--ink)]" },
  CANCELLED: { text: "Anulada", className: "bg-[var(--danger-soft)] text-[var(--danger)]" },
} as const;

export const IMPORT_STATUS = {
  DRAFT: { text: "Por confirmar", className: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  CONFIRMED: { text: "Importada", className: "bg-[var(--success-soft)] text-[var(--success)]" },
  UNDONE: { text: "Deshecha", className: "bg-[var(--danger-soft)] text-[var(--danger)]" },
  DISCARDED: { text: "Descartada", className: "bg-[var(--surface-2)] text-[var(--ink-dim)]" },
} as const;
