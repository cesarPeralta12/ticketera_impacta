/**
 * Contenido del QR de una entrada: "TK1.<código>.<firma>".
 *
 * La firma (HMAC-SHA256 truncado a 128 bits) impide fabricar QR válidos sin el secreto.
 * Requiere validar en línea: si el lector debe funcionar offline, se reemplaza por
 * una firma asimétrica (Ed25519) con prefijo TK2, sin repartir el secreto a los dispositivos.
 *
 * Usa Web Crypto, así que funciona igual en Node, en el navegador y en edge.
 */
import { isValidCode } from "./codes";

const PREFIX = "TK1";
const SIGNATURE_BYTES = 16;

export type ParsedTicketPayload =
  | { ok: true; code: string; source: "qr" | "manual" }
  | { ok: false; reason: "FORMAT" | "SIGNATURE" };

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(signature).slice(0, SIGNATURE_BYTES);
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signTicketPayload(code: string, secret: string): Promise<string> {
  const body = `${PREFIX}.${code}`;
  return `${body}.${toBase64Url(await hmac(secret, body))}`;
}

/**
 * Acepta el contenido completo del QR o el código impreso bajo el QR
 * (ingreso manual cuando el QR está dañado o la pantalla del celular está rota).
 */
export async function parseTicketPayload(raw: string, secret: string): Promise<ParsedTicketPayload> {
  const input = raw.trim();

  if (!input.startsWith(`${PREFIX}.`)) {
    const manual = input.replace(/-/g, "").toUpperCase();
    return isValidCode(manual) ? { ok: true, code: manual, source: "manual" } : { ok: false, reason: "FORMAT" };
  }

  const [prefix, code, signature, ...rest] = input.split(".");
  if (rest.length > 0 || prefix !== PREFIX || !code || !signature || !isValidCode(code)) {
    return { ok: false, reason: "FORMAT" };
  }
  const expected = toBase64Url(await hmac(secret, `${PREFIX}.${code}`));
  return constantTimeEqual(signature, expected)
    ? { ok: true, code, source: "qr" }
    : { ok: false, reason: "SIGNATURE" };
}
