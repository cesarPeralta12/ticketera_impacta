import { describe, expect, it } from "vitest";
import { code128Svg, code128Widths } from "./barcode";

describe("Code 128", () => {
  it("cada símbolo ocupa 11 módulos y la parada 13", () => {
    // "A" = valor 33: inicio + 1 dato + control + parada.
    const widths = code128Widths("A");
    expect(widths.reduce((a, b) => a + b, 0)).toBe(11 * 3 + 13);
  });

  it("calcula el dígito de control (START B + 'PJJ123C')", () => {
    // (104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7) mod 103 = 879 mod 103 = 55,
    // cuyo patrón es "311321".
    const tail = code128Widths("PJJ123C").slice(-(6 + 7)).slice(0, 6).join("");
    expect(tail).toBe("311321");
  });

  it("rechaza caracteres fuera de ASCII imprimible", () => {
    expect(() => code128Widths("ñ")).toThrow();
  });

  it("genera un SVG con barras", () => {
    const svg = code128Svg("K7Q3MXPA2B");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<rect");
  });
});
