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
import { parseDynamicPayload, parseManualWithOtp } from "./dynamic-qr";

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

/**
 * Código de entrada de un QR o de lo tipeado a mano, sin verificar la firma. Lo usa la app
 * de puerta sin conexión (no tiene el secreto): compara el código contra la lista
 * descargada. Los códigos son aleatorios, así que inventar uno que exista no es viable.
 */
export function extractTicketCode(raw: string): string | null {
  const input = raw.trim();
  if (input.startsWith("TK2.")) return parseDynamicPayload(input)?.code ?? null;
  const withOtp = parseManualWithOtp(input);
  if (withOtp) return withOtp.code;
  if (input.startsWith(`${PREFIX}.`)) {
    const [, code, signature, ...rest] = input.split(".");
    return code && signature && rest.length === 0 && isValidCode(code) ? code : null;
  }
  const manual = input.replace(/-/g, "").toUpperCase();
  return isValidCode(manual) ? manual : null;
}

// ─────────────── QR de consumo (vale de un solo uso) ───────────────

const VOUCHER_PREFIX = "CV1";

/** Contenido del QR de consumo de una mesa o de una entrada con trago: "CV1.<código>.<firma>". */
export async function signVoucherPayload(code: string, secret: string): Promise<string> {
  const body = `${VOUCHER_PREFIX}.${code}`;
  return `${body}.${toBase64Url(await hmac(secret, body))}`;
}

/** Código escrito a mano o leído de un QR de consumo, sin verificar la firma (la app de barra no tiene el secreto). */
export function extractVoucherCode(raw: string): string | null {
  const input = raw.trim();
  if (input.startsWith(`${VOUCHER_PREFIX}.`)) {
    const [, code, signature, ...rest] = input.split(".");
    return code && signature && rest.length === 0 && isValidCode(code) ? code : null;
  }
  const manual = input.replace(/-/g, "").toUpperCase();
  return isValidCode(manual) ? manual : null;
}

/** Como [extractVoucherCode] pero verificando la firma del QR (el servidor). Escrito a mano no lleva firma. */
export async function parseVoucherPayload(raw: string, secret: string): Promise<ParsedTicketPayload> {
  const input = raw.trim();
  if (!input.startsWith(`${VOUCHER_PREFIX}.`)) {
    const manual = input.replace(/-/g, "").toUpperCase();
    return isValidCode(manual) ? { ok: true, code: manual, source: "manual" } : { ok: false, reason: "FORMAT" };
  }
  const [, code, signature, ...rest] = input.split(".");
  if (rest.length > 0 || !code || !signature || !isValidCode(code)) return { ok: false, reason: "FORMAT" };
  const expected = toBase64Url(await hmac(secret, `${VOUCHER_PREFIX}.${code}`));
  return constantTimeEqual(signature, expected) ? { ok: true, code, source: "qr" } : { ok: false, reason: "SIGNATURE" };
}

// ─────────────── Vista previa de un evento sin publicar ───────────────

/** Cuánto dura el enlace de vista previa que arma el panel. */
export const PREVIEW_TOKEN_DAYS = 7;
const PREVIEW_CONTEXT = "vista-previa";

/**
 * Enlace firmado para ver un evento como lo verá el comprador aunque siga en borrador: "<evento>.<vence>.<firma>".
 * Lo firma el panel con el mismo secreto que los QR (con otro contexto, así una firma no sirve para la otra).
 */
export async function signPreviewToken(eventId: string, secret: string, expiresAt: Date): Promise<string> {
  const body = `${eventId}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${body}.${toBase64Url(await hmac(secret, `${PREVIEW_CONTEXT}.${body}`))}`;
}

/** El evento de un enlace de vista previa válido y vigente, o null. */
export async function verifyPreviewToken(token: string, secret: string, now: Date = new Date()): Promise<string | null> {
  const [eventId, expires, signature, ...rest] = token.split(".");
  if (rest.length > 0 || !eventId || !expires || !signature || !/^[a-z0-9]{10,40}$/.test(eventId) || !/^\d{9,12}$/.test(expires)) return null;
  if (Number(expires) * 1000 <= now.getTime()) return null;
  const expected = toBase64Url(await hmac(secret, `${PREVIEW_CONTEXT}.${eventId}.${expires}`));
  return constantTimeEqual(signature, expected) ? eventId : null;
}
