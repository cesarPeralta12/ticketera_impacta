/**
 * Número de serie (UID) de una tarjeta o manilla NFC. La app de canje lo lee y lo vincula a una entrada; la app de puerta
 * lo lee y busca la entrada. Para que los dos lo entiendan igual se guarda siempre normalizado: hexadecimal en
 * mayúsculas, sin separadores. Esta regla es la misma en el servidor y en las apps: los casos de nfc-uid.cases.json los
 * prueban los dos.
 *
 * Qué NO es el UID: no es una clave secreta. Una tarjeta de fábrica no lo deja cambiar, pero existen tarjetas «mágicas»
 * que lo copian. Por eso la entrada sigue valiendo una sola vez y cada paso queda registrado.
 */

/** Largos válidos en bytes: 4 (ISO 14443 corto), 7 (el de Mifare Ultralight, NTAG), 8 (ISO 15693) y 10. */
const VALID_BYTES = new Set([4, 7, 8, 10]);

/**
 * Normaliza lo que leyó la app («04:7F:8C:52:0F:7A:80», «04-7f-8c…», «047f8c…») o devuelve null si no sirve como
 * identificador: largo raro, no hexadecimal, todo ceros o unos, o un UID aleatorio.
 *
 * Un UID de 4 bytes que empieza en 08 es «aleatorio» (ISO 14443-3): lo emiten los teléfonos y las tarjetas virtuales y
 * cambia en cada lectura, así que no identifica a nadie.
 */
export function normalizeNfcUid(raw: string): string | null {
  const hex = raw.replace(/[\s:.\-]/g, "").toUpperCase();
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9A-F]+$/.test(hex)) return null;
  const bytes = hex.length / 2;
  if (!VALID_BYTES.has(bytes)) return null;
  if (/^0+$/.test(hex) || /^F+$/.test(hex)) return null;
  if (bytes === 4 && hex.startsWith("08")) return null;
  return hex;
}

/** Lo más largo que se acepta de la huella que manda la app (tipo de etiqueta, tecnologías…). */
export const MAX_NFC_CARD_JSON = 2048;

/** Huella de la tarjeta tal como la lee la app de canje. Solo `uid` identifica; lo demás sirve para revisar el modelo. */
export type NfcCardInfo = {
  uid: string;
  /** ISO 14443-3A, ISO 15693… */
  type?: string;
  /** Mifare Ultralight, NTAG… cuando la app lo sabe. */
  model?: string;
  /** Tecnologías que ofrece la etiqueta (NfcA, MifareUltralight, Ndef…). */
  tech?: string[];
  atqa?: string;
  sak?: string;
};

const short = (v: unknown, max = 60) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * Limpia la huella que manda la app: solo los campos conocidos, con largos acotados. El `uid` siempre sale del UID ya
 * normalizado (no de lo que diga el cuerpo), así la huella no puede contradecirlo.
 */
export function sanitizeNfcCard(uid: string, raw: unknown): NfcCardInfo {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tech = Array.isArray(body.tech) ? body.tech.map((t) => short(t, 40)).filter((t): t is string => !!t).slice(0, 12) : undefined;
  const info: NfcCardInfo = { uid };
  const type = short(body.type);
  const model = short(body.model);
  const atqa = short(body.atqa, 8);
  const sak = short(body.sak, 4);
  if (type) info.type = type;
  if (model) info.model = model;
  if (tech && tech.length > 0) info.tech = tech;
  if (atqa) info.atqa = atqa;
  if (sak) info.sak = sak;
  return info;
}
