import { describe, expect, it } from "vitest";
import { parseTicketPayload, signTicketPayload } from "./qr";

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
