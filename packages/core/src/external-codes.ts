/**
 * Códigos de entradas que ya existen fuera de iPass (vendidas por un tercero, con su propio QR o código impreso). El
 * código del tercero no reemplaza al de iPass: cada entrada importada tiene su código propio y además guarda el externo.
 * Para que la puerta no dependa de cómo se escribió en el Excel o de cómo viene en el QR, se compara una versión limpia
 * (la "clave"). Esta regla es la misma en el servidor y en la app de puerta: los casos de external-codes.cases.json los
 * prueban los dos.
 */

/** Cómo se limpia un código del tercero. Se guarda con cada lote importado. */
export type ExternalCodeRule = {
  /** Ignorar guiones y espacios del medio: ABC-123 = ABC123. */
  ignoreSeparators: boolean;
  /** Si el QR trae un enlace (https://proveedor.com/t/ABC123), usar lo que sigue a la última barra o al parámetro code=. */
  fromUrl: boolean;
  /** Prefijo o sufijo fijo que se quita (TKT-). Vacío = ninguno. */
  prefix: string;
  suffix: string;
  /** 00123 = 123. Por defecto no: son entradas distintas. */
  ignoreLeadingZeros: boolean;
};

export const DEFAULT_CODE_RULE: ExternalCodeRule = { ignoreSeparators: true, fromUrl: true, prefix: "", suffix: "", ignoreLeadingZeros: false };

/** Lo más largo que se acepta como código externo (un enlace completo puede ser largo; la clave no). */
export const MAX_EXTERNAL_CODE_LENGTH = 200;
const MAX_KEY_LENGTH = 100;

/** Parámetros de un enlace donde suele venir el código. */
const URL_PARAMS = ["code", "codigo", "ticket", "c", "t", "id"];

const separators = (text: string) => text.replace(/[\s-]+/g, "");

/** Lo que trae un enlace: el parámetro code= (o parecido) o lo que sigue a la última barra. */
function fromUrl(text: string): string {
  if (!/^https?:\/\//i.test(text)) return text;
  try {
    const url = new URL(text);
    for (const name of URL_PARAMS) {
      const value = url.searchParams.get(name);
      if (value?.trim()) return value.trim();
    }
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : text;
  } catch {
    return text;
  }
}

/**
 * La clave con la que se compara una lectura: sin espacios en los extremos, en mayúsculas y con las opciones de la
 * regla. null si no queda nada (o queda demasiado largo para ser un código).
 */
export function normalizeExternalCode(raw: string, rule: ExternalCodeRule = DEFAULT_CODE_RULE): string | null {
  let text = raw.trim();
  if (!text || text.length > MAX_EXTERNAL_CODE_LENGTH) return null;
  if (rule.fromUrl) text = fromUrl(text);
  text = text.trim().toUpperCase().replace(/\s+/g, " ");
  const clean = (part: string) => (rule.ignoreSeparators ? separators(part.toUpperCase()) : part.toUpperCase().trim());
  if (rule.ignoreSeparators) text = separators(text);
  const prefix = clean(rule.prefix);
  const suffix = clean(rule.suffix);
  if (prefix && text.startsWith(prefix) && text.length > prefix.length) text = text.slice(prefix.length);
  if (suffix && text.endsWith(suffix) && text.length > suffix.length) text = text.slice(0, -suffix.length);
  if (rule.ignoreLeadingZeros) text = text.replace(/^0+(?=.)/, "");
  return text && text.length <= MAX_KEY_LENGTH ? text : null;
}

/** Las claves posibles de una lectura con las reglas de los lotes de esa función (normalmente una o dos). */
export function externalKeyCandidates(raw: string, rules: ExternalCodeRule[]): string[] {
  return [...new Set(rules.flatMap((rule) => normalizeExternalCode(raw, rule) ?? []))];
}

/** Una regla guardada (JSON de la base o del formulario), con los valores por defecto donde falte algo. */
export function parseCodeRule(input: unknown): ExternalCodeRule {
  const r = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 20) : "");
  const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  return {
    ignoreSeparators: flag(r.ignoreSeparators, DEFAULT_CODE_RULE.ignoreSeparators),
    fromUrl: flag(r.fromUrl, DEFAULT_CODE_RULE.fromUrl),
    prefix: text(r.prefix),
    suffix: text(r.suffix),
    ignoreLeadingZeros: flag(r.ignoreLeadingZeros, DEFAULT_CODE_RULE.ignoreLeadingZeros),
  };
}

/**
 * Marca que el lector de Excel pone delante de una celda NUMÉRICA de más de 15 dígitos: Excel ya perdió los últimos
 * (1234567890123456789 se guarda como 1234567890123456800) y no se pueden recuperar. Una celda de texto no la lleva.
 */
export const LONG_NUMBER_MARK = "#NUMERO_LARGO#";

/** Para el lector de Excel: el número tal como está guardado, marcado si pasa de 15 dígitos o viene en notación científica. */
export function excelNumberText(stored: string): string {
  return /e[+-]?\d+$/i.test(stored) || stored.replace(/\D/g, "").length > 15 ? `${LONG_NUMBER_MARK}${stored}` : stored;
}

/** ¿El código perdió dígitos al guardarse como número (o vino en notación científica, como 1.23457E+18)? */
export function looksLikeMangledNumber(raw: string): boolean {
  const text = raw.trim();
  return text.startsWith(LONG_NUMBER_MARK) || /^\d+(\.\d+)?e\+\d+$/i.test(text);
}
