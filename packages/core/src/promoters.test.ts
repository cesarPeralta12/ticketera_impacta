import { describe, expect, it } from "vitest";
import { isValidPromoCode } from "./promo";
import { whatsappLink } from "./event-info";
import { commissionFor, commissionLabel, promoterCode } from "./promoters";

const bs = (c: number) => `Bs ${(c / 100).toFixed(2)}`;

describe("comisión del promotor", () => {
  it("el porcentaje es sobre lo que pagó el cliente y redondea al centavo", () => {
    expect(commissionFor({ commissionType: "PERCENT", commissionValue: 10 }, { totalAmount: 25_000, units: 2 })).toBe(2_500);
    expect(commissionFor({ commissionType: "PERCENT", commissionValue: 7 }, { totalAmount: 9_999, units: 1 })).toBe(700);
  });

  it("el monto fijo es por cada entrada o mesa vendida", () => {
    expect(commissionFor({ commissionType: "FIXED", commissionValue: 1_000 }, { totalAmount: 50_000, units: 4 })).toBe(4_000);
  });

  it("se describe en palabras", () => {
    expect(commissionLabel({ commissionType: "PERCENT", commissionValue: 10 }, bs)).toBe("10% de cada venta");
    expect(commissionLabel({ commissionType: "FIXED", commissionValue: 1_000 }, bs)).toBe("Bs 10.00 por entrada");
  });
});

describe("código y WhatsApp del promotor", () => {
  it("el código lleva el nombre y es válido", () => {
    const code = promoterCode("José Pérez");
    expect(code).toMatch(/^RP-JOSE-[A-Z0-9]{5}$/);
    expect(isValidPromoCode(code)).toBe(true);
    expect(promoterCode("")).toMatch(/^RP-[A-Z0-9]{5}$/);
  });

  it("arma el enlace de WhatsApp con el 591 de Bolivia", () => {
    expect(whatsappLink("7712 3456", "Hola")).toBe("https://wa.me/59177123456?text=Hola");
    expect(whatsappLink("+591 77123456", "Tus entradas: https://x.y/orden/A")).toBe(
      "https://wa.me/59177123456?text=Tus%20entradas%3A%20https%3A%2F%2Fx.y%2Forden%2FA",
    );
    expect(whatsappLink("123", "Hola")).toBeNull();
    expect(whatsappLink("77123456")).toBe("https://wa.me/59177123456");
  });
});
