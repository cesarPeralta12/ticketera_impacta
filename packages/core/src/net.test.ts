import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, describeUserAgent, isAllowedOrigin } from "./net";

describe("clientIpFromHeaders", () => {
  it("con un proxy toma la última IP (la que vio el proxy), no la que inventó el cliente", () => {
    expect(clientIpFromHeaders("1.2.3.4, 200.87.10.5", null, 1)).toBe("200.87.10.5");
  });
  it("un cliente que manda su propio x-forwarded-for no puede elegir su IP", () => {
    expect(clientIpFromHeaders("9.9.9.9, 8.8.8.8, 200.87.10.5", null, 1)).toBe("200.87.10.5");
  });
  it("con dos proxies (Cloudflare + Traefik) salta uno más", () => {
    expect(clientIpFromHeaders("9.9.9.9, 200.87.10.5, 172.16.0.2", null, 2)).toBe("200.87.10.5");
  });
  it("una cadena más corta que los saltos usa el primer valor", () => {
    expect(clientIpFromHeaders("200.87.10.5", null, 3)).toBe("200.87.10.5");
  });
  it("rechaza basura y cae a x-real-ip o 'desconocida'", () => {
    expect(clientIpFromHeaders("no-es-ip", "10.0.0.7", 1)).toBe("10.0.0.7");
    expect(clientIpFromHeaders("<script>", null, 1)).toBe("desconocida");
    expect(clientIpFromHeaders(null, null)).toBe("desconocida");
  });
  it("acepta IPv6", () => {
    expect(clientIpFromHeaders("2800:cd0:1::5", null, 1)).toBe("2800:cd0:1::5");
  });
});

describe("describeUserAgent", () => {
  it("reconoce navegadores y sistemas comunes", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36")).toBe("Chrome en Windows");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120")).toBe("Edge en Windows");
    expect(describeUserAgent("Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0")).toBe("Firefox en Android");
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17 Safari/604")).toBe("Safari en iOS");
  });
  it("reconoce la app de puerta y las herramientas", () => {
    expect(describeUserAgent("impacta-puerta/1.0 (android)")).toBe("App de puerta");
    expect(describeUserAgent("curl/8.4.0")).toBe("Script/herramienta");
  });
  it("sin dato, 'Desconocido'", () => {
    expect(describeUserAgent(null)).toBe("Desconocido");
  });
});

describe("isAllowedOrigin", () => {
  const hosts = ["ticketera.proshop.lat", null];
  it("sin Origin pasa (app móvil, curl, GET normal)", () => {
    expect(isAllowedOrigin(null, hosts)).toBe(true);
  });
  it("el mismo sitio pasa y otro sitio no", () => {
    expect(isAllowedOrigin("https://ticketera.proshop.lat", hosts)).toBe(true);
    expect(isAllowedOrigin("https://malo.example", hosts)).toBe(false);
    expect(isAllowedOrigin("https://ticketera.proshop.lat.malo.example", hosts)).toBe(false);
  });
  it("Origin 'null' o inválido se rechaza", () => {
    expect(isAllowedOrigin("null", hosts)).toBe(false);
  });
});
