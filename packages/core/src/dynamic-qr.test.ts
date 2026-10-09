import { describe, expect, it } from "vitest";
import {
  STEP_SECONDS,
  deriveTicketKey,
  dynamicOtp,
  dynamicProof,
  fromBase64Url,
  parseDynamicPayload,
  parseManualWithOtp,
  signDynamicPayload,
  stepAt,
  toBase64Url,
  verifyDynamicOtp,
  verifyDynamicPayload,
} from "./dynamic-qr";

const SECRET = "secreto-de-prueba";
const CODE = "K7Q3MXPA2B";
const STEP = 57_000_000;
const AT = STEP * STEP_SECONDS * 1000; // inicio exacto del paso

/**
 * VECTORES COMPARTIDOS: los mismos valores están en apps/puerta_app/test/dynamic_qr_test.dart.
 * Si cambian aquí, tienen que cambiar allá: la app de puerta y el servidor deben calcular lo mismo.
 */
const VECTORS = [
  { code: "K7Q3MXPA2B", key: "8KhyKt-6YzLCPb3tRjidJA", step: 57_000_000, stepText: "xxphc", proof: "PdfGc_G5sWo", otp: "203145" },
  { code: "K7Q3MXPA2B", key: "8KhyKt-6YzLCPb3tRjidJA", step: 57_000_001, stepText: "xxphd", proof: "eHIooOWZyu4", otp: "658147" },
  { code: "ZZ9988AABB", key: "kpQgT_DmtZ8AscLVrmdQUw", step: 57_000_000, stepText: "xxphc", proof: "Kd_9_qG64Go", otp: "135476" },
];

describe("vectores compartidos con la app de puerta", () => {
  for (const v of VECTORS) {
    it(`${v.code} paso ${v.step}`, async () => {
      const key = await deriveTicketKey(SECRET, v.code);
      expect(toBase64Url(key)).toBe(v.key);
      expect(v.step.toString(36)).toBe(v.stepText);
      expect(await dynamicProof(key, v.code, v.step)).toBe(v.proof);
      expect(await dynamicOtp(key, v.code, v.step)).toBe(v.otp);
    });
  }
});

describe("QR dinámico", () => {
  it("el contenido tiene el formato TK2.<código>.<paso>.<prueba> y cambia cada paso", async () => {
    const key = await deriveTicketKey(SECRET, CODE);
    const a = await signDynamicPayload(key, CODE, AT);
    const b = await signDynamicPayload(key, CODE, AT + STEP_SECONDS * 1000);
    expect(a).toBe("TK2.K7Q3MXPA2B.xxphc.PdfGc_G5sWo");
    expect(a).not.toBe(b);
    // Dentro del mismo paso es idéntico (el QR no parpadea).
    expect(await signDynamicPayload(key, CODE, AT + 29_999)).toBe(a);
    expect(parseDynamicPayload(a)).toEqual({ code: CODE, step: STEP, proof: "PdfGc_G5sWo" });
  });

  it("la llave es distinta para cada entrada y para cada secreto", async () => {
    const k1 = await deriveTicketKey(SECRET, "K7Q3MXPA2B");
    const k2 = await deriveTicketKey(SECRET, "ZZ9988AABB");
    const k3 = await deriveTicketKey("otro-secreto", "K7Q3MXPA2B");
    expect(toBase64Url(k1)).not.toBe(toBase64Url(k2));
    expect(toBase64Url(k1)).not.toBe(toBase64Url(k3));
    expect(k1).toHaveLength(16);
  });

  it("acepta el paso actual y los vecinos, y marca vencido lo demás", async () => {
    const key = await deriveTicketKey(SECRET, CODE);
    const at = (offset: number) => parseDynamicPayload(`TK2.${CODE}.${(STEP + offset).toString(36)}.${"x".repeat(11)}`)!;
    const sign = async (offset: number) => parseDynamicPayload(await signDynamicPayload(key, CODE, AT + offset * STEP_SECONDS * 1000))!;
    const now = AT + 5_000;
    expect(await verifyDynamicPayload(key, await sign(0), now)).toBe("OK");
    expect(await verifyDynamicPayload(key, await sign(-1), now)).toBe("OK"); // reloj atrasado
    expect(await verifyDynamicPayload(key, await sign(1), now)).toBe("OK"); // reloj adelantado
    expect(await verifyDynamicPayload(key, await sign(-2), now)).toBe("EXPIRED"); // captura de hace un minuto
    expect(await verifyDynamicPayload(key, await sign(-1000), now)).toBe("EXPIRED"); // captura de hace horas
    expect(await verifyDynamicPayload(key, await sign(2), now)).toBe("EXPIRED");
    expect(at(0).proof).toHaveLength(11);
  });

  it("una prueba falsificada, de otra entrada o de otro secreto es INVALID, no vencida", async () => {
    const key = await deriveTicketKey(SECRET, CODE);
    const now = AT;
    const good = parseDynamicPayload(await signDynamicPayload(key, CODE, AT))!;
    expect(await verifyDynamicPayload(key, { ...good, proof: "AAAAAAAAAAA" }, now)).toBe("INVALID");
    // La prueba de otra entrada no sirve en esta.
    const otherKey = await deriveTicketKey(SECRET, "ZZ9988AABB");
    const other = parseDynamicPayload(await signDynamicPayload(otherKey, "ZZ9988AABB", AT))!;
    expect(await verifyDynamicPayload(key, { ...good, proof: other.proof }, now)).toBe("INVALID");
    // Cambiar el paso a mano (para "rejuvenecer" una captura) invalida la prueba.
    expect(await verifyDynamicPayload(key, { ...good, step: good.step + 5 }, now + 5 * STEP_SECONDS * 1000)).toBe("INVALID");
    // Llave equivocada.
    const wrong = await deriveTicketKey("otro-secreto", CODE);
    expect(await verifyDynamicPayload(wrong, good, now)).toBe("INVALID");
  });

  it("rechaza formatos que no son un QR dinámico", () => {
    expect(parseDynamicPayload("TK1.K7Q3MXPA2B.abc")).toBeNull();
    expect(parseDynamicPayload("TK2.K7Q3MXPA2B.xxphc")).toBeNull();
    expect(parseDynamicPayload("TK2.K7Q3MXPA2B.xxphc.PdfGc_G5sWo.extra")).toBeNull();
    expect(parseDynamicPayload("TK2.K7Q3MXPA20.xxphc.PdfGc_G5sWo")).toBeNull(); // el 0 no está en el alfabeto
    expect(parseDynamicPayload("TK2.K7Q3MXPA2B.xx!!c.PdfGc_G5sWo")).toBeNull();
    expect(parseDynamicPayload("TK2.K7Q3MXPA2B.xxphc.corta")).toBeNull();
    expect(parseDynamicPayload("hola")).toBeNull();
  });

  it("stepAt cambia exactamente cada 30 segundos", () => {
    expect(stepAt(AT)).toBe(STEP);
    expect(stepAt(AT + 29_999)).toBe(STEP);
    expect(stepAt(AT + 30_000)).toBe(STEP + 1);
  });

  it("base64url ida y vuelta", () => {
    const bytes = Uint8Array.from([250, 251, 252, 0, 1, 2, 255]);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
  });
});

describe("respaldo escrito a mano (código + OTP)", () => {
  it("separa el código (con o sin guion) del OTP", () => {
    expect(parseManualWithOtp("K7Q3M-XPA2B 203145")).toEqual({ code: "K7Q3MXPA2B", otp: "203145" });
    expect(parseManualWithOtp("  k7q3mxpa2b   203145 ")).toEqual({ code: "K7Q3MXPA2B", otp: "203145" });
    expect(parseManualWithOtp("K7Q3MXPA2B")).toBeNull();
    expect(parseManualWithOtp("K7Q3MXPA2B 12345")).toBeNull();
    expect(parseManualWithOtp("K7Q3MXPA20 203145")).toBeNull();
  });

  it("el OTP vale en la ventana y no fuera de ella", async () => {
    const key = await deriveTicketKey(SECRET, CODE);
    const now = AT + 10_000;
    expect(await verifyDynamicOtp(key, CODE, "203145", now)).toBe(true); // paso actual
    expect(await verifyDynamicOtp(key, CODE, "658147", now)).toBe(true); // paso siguiente
    expect(await verifyDynamicOtp(key, CODE, "203145", now + 3 * STEP_SECONDS * 1000)).toBe(false); // vencido
    expect(await verifyDynamicOtp(key, CODE, "000000", now)).toBe(false);
  });
});
