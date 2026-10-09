/**
 * QR dinámico: la entrada es siempre la misma (su código); lo que cambia cada 30 segundos es una PRUEBA
 * calculada con una llave propia de esa entrada. La puerta recibe la llave antes del evento y recalcula la
 * prueba sin internet. Una captura vieja no pasa: su prueba es de otro paso.
 *
 *   llave  = HMAC-SHA256(secreto, "dyn1|" + código)[0..16]       (se deriva; no se guarda)
 *   paso   = floor(hora_ms / 30000)
 *   prueba = HMAC-SHA256(llave, "TK2|" + código + "|" + paso)[0..8]  → base64url (11 caracteres)
 *   QR     = "TK2." + código + "." + paso(base36) + "." + prueba
 *   manual = código + " " + OTP de 6 dígitos (HMAC con la etiqueta "OTP|"), como un TOTP
 *
 * Usa Web Crypto: corre igual en Node, en el navegador (la página de la entrada genera el QR en el celular
 * del comprador sin internet) y en las pruebas. Hay una implementación equivalente en Dart (app de puerta);
 * los vectores de prueba de `dynamic-qr.test.ts` y de `validator_test.dart` deben coincidir.
 */
import { isValidCode } from "./codes";

export const DYNAMIC_PREFIX = "TK2";
/** Cada cuántos segundos cambia el QR. */
export const STEP_SECONDS = 30;
/** Pasos que se aceptan antes y después del actual (relojes desajustados): ±1 paso ≈ 90 segundos en total. */
export const STEP_WINDOW = 1;
const KEY_BYTES = 16;
const PROOF_BYTES = 8;
const OTP_DIGITS = 6;

const encoder = new TextEncoder();

async function hmac(key: Uint8Array | string, message: string): Promise<Uint8Array> {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(message)));
}

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Llave de una entrada, derivada del secreto del servidor y de su código (al transferirla cambia el código, y con él la llave). */
export async function deriveTicketKey(secret: string, code: string): Promise<Uint8Array> {
  return (await hmac(secret, `dyn1|${code}`)).slice(0, KEY_BYTES);
}

/** Paso de tiempo al que pertenece un instante (ms desde 1970). */
export const stepAt = (timeMs: number) => Math.floor(timeMs / (STEP_SECONDS * 1000));

/** Prueba de un paso, en base64url (11 caracteres). */
export async function dynamicProof(key: Uint8Array, code: string, step: number): Promise<string> {
  return toBase64Url((await hmac(key, `${DYNAMIC_PREFIX}|${code}|${step}`)).slice(0, PROOF_BYTES));
}

/** Contenido del QR dinámico para un instante. */
export async function signDynamicPayload(key: Uint8Array, code: string, timeMs: number): Promise<string> {
  const step = stepAt(timeMs);
  return `${DYNAMIC_PREFIX}.${code}.${step.toString(36)}.${await dynamicProof(key, code, step)}`;
}

/** OTP de 6 dígitos de un paso (respaldo para escribir a mano en la puerta). */
export async function dynamicOtp(key: Uint8Array, code: string, step: number): Promise<string> {
  const mac = await hmac(key, `OTP|${code}|${step}`);
  const offset = mac[mac.length - 1]! & 0x0f; // truncado dinámico, como RFC 4226
  const value = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(value % 10 ** OTP_DIGITS).padStart(OTP_DIGITS, "0");
}

export type ParsedDynamicPayload = { code: string; step: number; proof: string };

/** Formato del QR dinámico (no verifica la prueba). null si no es un `TK2` bien formado. */
export function parseDynamicPayload(raw: string): ParsedDynamicPayload | null {
  const parts = raw.trim().split(".");
  if (parts.length !== 4 || parts[0] !== DYNAMIC_PREFIX) return null;
  const [, code, stepText, proof] = parts as [string, string, string, string];
  if (!isValidCode(code) || !/^[0-9a-z]{1,10}$/.test(stepText) || !/^[A-Za-z0-9_-]{11}$/.test(proof)) return null;
  const step = parseInt(stepText, 36);
  return Number.isSafeInteger(step) ? { code, step, proof } : null;
}

export type DynamicVerdict = "OK" | "EXPIRED" | "INVALID";

/**
 * Verifica un QR dinámico. INVALID: la prueba no corresponde a esta entrada (falsificado o llave equivocada).
 * EXPIRED: la prueba es auténtica pero de otro paso (captura vieja o reloj muy desajustado). OK: auténtica y
 * dentro de la ventana.
 */
export async function verifyDynamicPayload(
  key: Uint8Array,
  payload: ParsedDynamicPayload,
  nowMs: number,
  window = STEP_WINDOW,
): Promise<DynamicVerdict> {
  const expected = await dynamicProof(key, payload.code, payload.step);
  if (!constantTimeEqual(payload.proof, expected)) return "INVALID";
  return Math.abs(payload.step - stepAt(nowMs)) <= window ? "OK" : "EXPIRED";
}

/** Separa "CÓDIGO 123456" (con o sin guiones en el código). null si no tiene esa forma. */
export function parseManualWithOtp(raw: string): { code: string; otp: string } | null {
  const m = /^\s*([A-Za-z0-9-]{10,11})\s+(\d{6})\s*$/.exec(raw);
  if (!m) return null;
  const code = m[1]!.replace(/-/g, "").toUpperCase();
  return isValidCode(code) ? { code, otp: m[2]! } : null;
}

/** Verifica el OTP escrito a mano: vale el de cualquiera de los pasos de la ventana. */
export async function verifyDynamicOtp(key: Uint8Array, code: string, otp: string, nowMs: number, window = STEP_WINDOW): Promise<boolean> {
  const now = stepAt(nowMs);
  for (let step = now - window; step <= now + window; step++) {
    if (constantTimeEqual(otp, await dynamicOtp(key, code, step))) return true;
  }
  return false;
}
