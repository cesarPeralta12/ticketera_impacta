import { describe, expect, it } from "vitest";
import { extractTicketCode, extractVoucherCode, parseTicketPayload, parseVoucherPayload, signPreviewToken, signTicketPayload, signVoucherPayload, verifyPreviewToken } from "./qr";

const SECRET = "secreto-de-prueba";

describe("QR de entradas", () => {
  it("firma y valida el contenido", async () => {
    const payload = await signTicketPayload("K7Q3MXPA2B", SECRET);
    expect(payload).toMatch(/^TK1\.K7Q3MXPA2B\.[A-Za-z0-9_-]{22}$/);
    expect(await parseTicketPayload(payload, SECRET)).toEqual({
      ok: true,
      code: "K7Q3MXPA2B",
      source: "qr",
    });
  });

  it("rechaza una firma alterada o hecha con otro secreto", async () => {
    const payload = await signTicketPayload("K7Q3MXPA2B", SECRET);
    const forged = payload.replace("K7Q3MXPA2B", "K7Q3MXPA2C");
    expect(await parseTicketPayload(forged, SECRET)).toEqual({ ok: false, reason: "SIGNATURE" });
    expect(await parseTicketPayload(payload, "otro-secreto")).toEqual({
      ok: false,
      reason: "SIGNATURE",
    });
  });

  it("acepta el código impreso para ingreso manual", async () => {
    expect(await parseTicketPayload(" k7q3m-xpa2b ", SECRET)).toEqual({
      ok: true,
      code: "K7Q3MXPA2B",
      source: "manual",
    });
  });

  it("rechaza basura", async () => {
    expect(await parseTicketPayload("hola", SECRET)).toEqual({ ok: false, reason: "FORMAT" });
    expect(await parseTicketPayload("TK1.K7Q3MXPA2B", SECRET)).toEqual({ ok: false, reason: "FORMAT" });
  });
});

describe("extractTicketCode (puerta sin conexión)", () => {
  it("saca el código del QR o de lo tipeado, sin necesitar el secreto", async () => {
    const qr = await signTicketPayload("K7Q3MXPA2B", "secreto");
    expect(extractTicketCode(qr)).toBe("K7Q3MXPA2B");
    expect(extractTicketCode(" k7q3m-xpa2b ")).toBe("K7Q3MXPA2B");
    expect(extractTicketCode("https://otra-cosa.com")).toBeNull();
    expect(extractTicketCode("TK1.K7Q3MXPA2B")).toBeNull();
  });
});

describe("enlace de vista previa", () => {
  const secret = "secreto-de-prueba";
  const later = new Date(Date.now() + 86_400_000);
  it("vale para su evento hasta que vence", async () => {
    const token = await signPreviewToken("cmva1kxtk000dz47ktcvke49z", secret, later);
    expect(await verifyPreviewToken(token, secret)).toBe("cmva1kxtk000dz47ktcvke49z");
    expect(await verifyPreviewToken(token, secret, new Date(later.getTime() + 1000))).toBeNull();
  });
  it("no se puede cambiar el evento, la fecha ni usar otro secreto", async () => {
    const token = await signPreviewToken("cmva1kxtk000dz47ktcvke49z", secret, later);
    const [, expires, signature] = token.split(".");
    expect(await verifyPreviewToken(`cmotroevento0000000000000.${expires}.${signature}`, secret)).toBeNull();
    expect(await verifyPreviewToken(`cmva1kxtk000dz47ktcvke49z.${Number(expires) + 99999}.${signature}`, secret)).toBeNull();
    expect(await verifyPreviewToken(token, "otro-secreto")).toBeNull();
    // La firma de un QR no sirve como vista previa.
    expect(await verifyPreviewToken("TK1.ABCD.xyz", secret)).toBeNull();
  });
});

describe("QR de consumo", () => {
  it("firma y valida el vale, y no se confunde con una entrada", async () => {
    const payload = await signVoucherPayload("K7Q3MXPA2B", SECRET);
    expect(payload).toMatch(/^CV1\.K7Q3MXPA2B\.[A-Za-z0-9_-]{22}$/);
    expect(await parseVoucherPayload(payload, SECRET)).toEqual({ ok: true, code: "K7Q3MXPA2B", source: "qr" });
    // El QR de una entrada no vale como vale de consumo, ni al revés.
    expect(await parseVoucherPayload(await signTicketPayload("K7Q3MXPA2B", SECRET), SECRET)).toMatchObject({ ok: false });
    expect(await parseTicketPayload(payload, SECRET)).toMatchObject({ ok: false });
  });

  it("rechaza una firma alterada o de otro secreto; acepta el código escrito", async () => {
    const payload = await signVoucherPayload("K7Q3MXPA2B", SECRET);
    expect(await parseVoucherPayload(payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A"), SECRET)).toEqual({ ok: false, reason: "SIGNATURE" });
    expect(await parseVoucherPayload(payload, "otro")).toEqual({ ok: false, reason: "SIGNATURE" });
    expect(await parseVoucherPayload("k7q3m-xpa2b", SECRET)).toEqual({ ok: true, code: "K7Q3MXPA2B", source: "manual" });
  });

  it("la app de barra saca el código sin verificar la firma", async () => {
    expect(extractVoucherCode(await signVoucherPayload("K7Q3MXPA2B", SECRET))).toBe("K7Q3MXPA2B");
    expect(extractVoucherCode("K7Q3M-XPA2B")).toBe("K7Q3MXPA2B");
    expect(extractVoucherCode("TK1.K7Q3MXPA2B.firma")).toBeNull();
    expect(extractVoucherCode("hola")).toBeNull();
  });
});
