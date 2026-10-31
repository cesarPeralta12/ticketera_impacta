import { describe, expect, it } from "vitest";
import { canDownloadTicketImage, canDownloadVoucherImage, isPastNight, nightEndsAt } from "./ticket-image";

const base = { status: "VALID", qrMode: "STATIC" as const, accessMethods: ["QR"], maxEntries: 1 };

describe("canDownloadTicketImage", () => {
  it("se descarga con QR fijo, con código de barras o con los dos", () => {
    expect(canDownloadTicketImage(base)).toBe(true);
    expect(canDownloadTicketImage({ ...base, accessMethods: ["BARCODE"] })).toBe(true);
    expect(canDownloadTicketImage({ ...base, accessMethods: ["QR", "BARCODE"] })).toBe(true);
  });

  it("con QR y NFC se descarga (solo el QR); solo NFC no", () => {
    expect(canDownloadTicketImage({ ...base, accessMethods: ["QR", "NFC"] })).toBe(true);
    expect(canDownloadTicketImage({ ...base, accessMethods: ["NFC"] })).toBe(false);
  });

  it("el QR dinámico no se descarga", () => {
    expect(canDownloadTicketImage({ ...base, qrMode: "DYNAMIC" })).toBe(false);
    expect(canDownloadTicketImage({ ...base, qrMode: "DYNAMIC", accessMethods: ["QR", "BARCODE"] })).toBe(false);
  });

  it("anulada, transferida o vencida no se descargan", () => {
    expect(canDownloadTicketImage({ ...base, status: "CANCELLED" })).toBe(false);
    expect(canDownloadTicketImage({ ...base, status: "EXPIRED" })).toBe(false);
    expect(canDownloadTicketImage({ ...base, transferredAway: true })).toBe(false);
  });

  it("ya leída: con reingreso sigue sirviendo; sin reingreso, no", () => {
    expect(canDownloadTicketImage({ ...base, status: "USED", maxEntries: 0 })).toBe(true);
    expect(canDownloadTicketImage({ ...base, status: "USED", maxEntries: 3 })).toBe(true);
    expect(canDownloadTicketImage({ ...base, status: "USED", maxEntries: 1 })).toBe(false);
  });
});

describe("canDownloadVoucherImage", () => {
  it("solo mientras no se leyó, no se anuló y tiene consumo", () => {
    expect(canDownloadVoucherImage({ amount: 2000, redeemedAt: null, cancelled: false })).toBe(true);
    expect(canDownloadVoucherImage({ amount: 2000, redeemedAt: new Date(), cancelled: false })).toBe(false);
    expect(canDownloadVoucherImage({ amount: 2000, redeemedAt: null, cancelled: true })).toBe(false);
    expect(canDownloadVoucherImage({ amount: 0, redeemedAt: null, cancelled: false })).toBe(false);
  });
});

describe("isPastNight", () => {
  const start = new Date("2026-10-31T03:30:00Z");

  it("sin hora de fin, la función dura 12 horas desde que empieza", () => {
    expect(nightEndsAt(start).toISOString()).toBe("2026-10-31T15:30:00.000Z");
    expect(isPastNight(start, null, new Date("2026-10-31T15:29:00Z"))).toBe(false);
    expect(isPastNight(start, null, new Date("2026-10-31T15:31:00Z"))).toBe(true);
  });

  it("con hora de fin, se agrega un margen de 3 horas para salir y volver a entrar", () => {
    const end = new Date("2026-10-31T09:00:00Z");
    expect(isPastNight(start, end, new Date("2026-10-31T11:59:00Z"))).toBe(false);
    expect(isPastNight(start, end, new Date("2026-10-31T12:01:00Z"))).toBe(true);
  });

  it("una función futura no es pasada", () => {
    expect(isPastNight(start, null, new Date("2026-10-01T00:00:00Z"))).toBe(false);
  });
});
