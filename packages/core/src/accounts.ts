/** Largo mínimo de contraseña para compradores y staff. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Carnet de identidad (o NIT/pasaporte): en mayúsculas y sin espacios, puntos ni guiones, para que
 * "1234567 lp", "1.234.567-LP" y "1234567LP" sean la misma persona.
 */
export function normalizeDocument(raw: string): string {
  return raw.toUpperCase().replace(/[\s.\-]/g, "");
}

/** 5 a 15 letras o números, con al menos 4 números (ej. 1234567, 1234567LP, 1234567-1A). */
export function isValidDocument(normalized: string): boolean {
  return /^[0-9A-Z]{5,15}$/.test(normalized) && (normalized.match(/\d/g)?.length ?? 0) >= 4;
}

export const DOCUMENT_ERROR = "Ingresa un carnet de identidad válido (5 a 15 caracteres, con números).";
