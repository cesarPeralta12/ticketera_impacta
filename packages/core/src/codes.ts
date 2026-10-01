/**
 * Códigos legibles para órdenes y entradas (soporte, QR, búsqueda en puerta).
 *
 * Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L) para que se puedan dictar por
 * teléfono. 10 caracteres sobre 31 símbolos ≈ 49 bits de entropía: no se pueden
 * adivinar, pero NO son un mecanismo de seguridad; el QR firmado se define en Sprint 0.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function randomCode(length = 10): string {
  // Rechazo de muestras para no sesgar: 256 no es múltiplo de 31.
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte < limit) out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** "K7Q3MXPA2B" -> "K7Q3M-XPA2B" */
export function formatCode(code: string): string {
  return code.length > 5 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

export function isValidCode(code: string, length = 10): boolean {
  const clean = code.replace(/-/g, "").toUpperCase();
  return clean.length === length && [...clean].every((c) => ALPHABET.includes(c));
}
