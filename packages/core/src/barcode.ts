/**
 * Código de barras Code 128 (set B) de una entrada, como SVG.
 *
 * Es el código corto de la entrada SIN firma: sirve para entradas impresas, boletería y lectores
 * láser. La app de puerta lo lee igual que el código escrito a mano (se valida contra la lista).
 */

/** Patrones de ancho de barras/espacios (6 módulos) de los 106 símbolos, más el de parada. */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232",
];
const STOP = "2331112";
const START_B = 104;

/** Secuencia de anchos (barra, espacio, barra…) del código, con inicio, dígito de control y parada. */
export function code128Widths(text: string): number[] {
  const values = [...text].map((ch) => {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error("Code 128 (set B) solo admite ASCII imprimible.");
    return code - 32;
  });
  const checksum = values.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  const symbols = [START_B, ...values, checksum];
  return [...symbols.map((s) => PATTERNS[s]).join("") + STOP].flatMap((d) => d.split("").map(Number));
}

/** SVG del código de barras. `moduleWidth` y `height` en píxeles; incluye zona de silencio de 10 módulos. */
export function code128Svg(text: string, opts: { moduleWidth?: number; height?: number } = {}): string {
  const moduleWidth = opts.moduleWidth ?? 2;
  const height = opts.height ?? 64;
  const widths = code128Widths(text);
  const quiet = 10 * moduleWidth;
  let x = quiet;
  let bars = "";
  widths.forEach((w, i) => {
    const px = w * moduleWidth;
    if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${px}" height="${height}"/>`;
    x += px;
  });
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" width="${total}" height="${height}" role="img" aria-label="Código de barras ${text}" shape-rendering="crispEdges"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${bars}</g></svg>`;
}
