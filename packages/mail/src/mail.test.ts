import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail, close: vi.fn() })) };
});
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { sendEmail, ticketsMessage, verifyEmailMessage } from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("correo", () => {
  it("en modo consola guarda el correo con las imágenes incrustadas y no envía nada", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mail-"));
    vi.stubEnv("MAIL_PROVIDER", "console");
    vi.stubEnv("DEV_MAIL_DIR", dir);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const email = ticketsMessage({
      to: "ana@prueba.test",
      buyerName: "Ana Rojas",
      eventTitle: "Loko <Fest>",
      startsAt: new Date("2026-11-12T20:00:00Z"),
      timezone: "America/La_Paz",
      venueName: "Arena 26",
      orderCode: "ABC123",
      orderUrl: "http://localhost:3000/orden/ABC123",
      tickets: [{ code: "K7Q3MXPA2B", typeName: "General", seat: null, qrPng: Buffer.from("png") }],
    });
    expect(email.html).toContain("cid:qr-1");
    expect(email.html).toContain("Loko &lt;Fest&gt;"); // el HTML del usuario se escapa
    expect(email.images).toHaveLength(1);

    expect((await sendEmail(email)).provider).toBe("console");
    const [file] = await readdir(dir);
    const saved = await readFile(path.join(dir, file!), "utf8");
    expect(saved).toContain("data:image/png;base64,");
    expect(saved).not.toContain("cid:qr-1");
  });

  it("una entrada de QR dinámico no lleva imagen: lleva un botón para abrirla y la advertencia de abrirla con internet", () => {
    const email = ticketsMessage({
      to: "ana@prueba.test",
      buyerName: "Ana Rojas",
      eventTitle: "Noche Electrónica",
      startsAt: new Date("2026-11-12T20:00:00Z"),
      timezone: "America/La_Paz",
      venueName: "Sonilum Plaza",
      orderUrl: "https://ticketera.proshop.lat/mis-entradas",
      tickets: [{ code: "K7Q3MXPA2B", typeName: "VIP", seat: null, qrPng: null, dynamicUrl: "https://ticketera.proshop.lat/entrada/K7Q3MXPA2B" }],
    });
    expect(email.images ?? []).toHaveLength(0);
    expect(email.html).not.toContain("cid:");
    expect(email.html).toContain("https://ticketera.proshop.lat/entrada/K7Q3MXPA2B");
    expect(email.html).toContain("antes de salir");
    expect(email.text).toContain("https://ticketera.proshop.lat/entrada/K7Q3MXPA2B");
  });

  it("cada entrada del correo dice por qué puerta ingresar", () => {
    const email = ticketsMessage({
      to: "ana@prueba.test",
      buyerName: "Ana Rojas",
      eventTitle: "Loko Fest",
      startsAt: new Date("2026-11-12T20:00:00Z"),
      timezone: "America/La_Paz",
      venueName: "Arena 26",
      orderUrl: "https://ticketera.proshop.lat/mis-entradas",
      tickets: [
        { code: "K7Q3MXPA2B", typeName: "Campo", seat: null, qrPng: null, entrance: "Ingreso por: Acceso norte" },
        { code: "ZZ9988AABB", typeName: "Palco", seat: null, qrPng: null, entrance: "Ingreso por: Acceso sur" },
      ],
    });
    expect(email.html).toContain("Ingreso por: Acceso norte");
    expect(email.html).toContain("Ingreso por: Acceso sur");
    expect(email.text).toContain("Ingreso por: Acceso norte");
  });

  it("con Resend manda la API key, el remitente y las imágenes como adjuntos en línea", async () => {
    vi.stubEnv("MAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("MAIL_FROM", "Impacta <entradas@impacta.test>");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const email = verifyEmailMessage({ to: "ana@prueba.test", name: "Ana", link: "https://x.test/v?token=abc", hours: 24 });
    email.images = [{ cid: "qr-1", filename: "a.png", content: Buffer.from("x"), contentType: "image/png" }];
    expect(await sendEmail(email)).toEqual({ provider: "resend", id: "msg_1" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: "Impacta <entradas@impacta.test>", to: ["ana@prueba.test"] });
    expect(body.attachments[0]).toMatchObject({ content_id: "qr-1", content: Buffer.from("x").toString("base64") });
    vi.unstubAllGlobals();
  });

  it("si Resend rechaza el correo, lanza un error con el motivo", async () => {
    vi.stubEnv("MAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("domain not verified", { status: 403 })));
    await expect(sendEmail({ to: "a@b.test", subject: "x", html: "x", text: "x" })).rejects.toThrow(/403/);
    vi.unstubAllGlobals();
  });

  it("con SMTP (Gmail) usa TLS en el 465, el nombre del remitente, responder-a y las imágenes en línea", async () => {
    vi.stubEnv("MAIL_PROVIDER", "smtp");
    vi.stubEnv("SMTP_HOST", "smtp.gmail.com");
    vi.stubEnv("SMTP_PORT", "465");
    vi.stubEnv("SMTP_USER", "impacta@gmail.com");
    vi.stubEnv("SMTP_PASS", "clave-de-aplicacion");
    vi.stubEnv("MAIL_FROM", "Impacta (no responder) <impacta@gmail.com>");
    vi.stubEnv("MAIL_REPLY_TO", "soporte@impacta.test");
    sendMail.mockResolvedValue({ messageId: "<abc@gmail.com>" });

    const email = verifyEmailMessage({ to: "ana@prueba.test", name: "Ana", link: "https://x.test/v", hours: 24 });
    email.images = [{ cid: "qr-1", filename: "a.png", content: Buffer.from("x"), contentType: "image/png" }];
    expect(await sendEmail(email)).toEqual({ provider: "smtp", id: "<abc@gmail.com>" });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: "impacta@gmail.com", pass: "clave-de-aplicacion" } }),
    );
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      from: "Impacta (no responder) <impacta@gmail.com>",
      replyTo: "soporte@impacta.test",
      to: "ana@prueba.test",
      attachments: [expect.objectContaining({ cid: "qr-1", contentDisposition: "inline" })],
    });
  });

  it("con SMTP sin credenciales avisa qué falta, y si el servidor rechaza lo dice", async () => {
    vi.stubEnv("MAIL_PROVIDER", "smtp");
    vi.stubEnv("SMTP_HOST", "smtp.gmail.com");
    await expect(sendEmail({ to: "a@b.test", subject: "x", html: "x", text: "x" })).rejects.toThrow(/SMTP_USER/);

    vi.stubEnv("SMTP_USER", "impacta@gmail.com");
    vi.stubEnv("SMTP_PASS", "mala");
    sendMail.mockRejectedValue(new Error("535 Username and Password not accepted"));
    await expect(sendEmail({ to: "a@b.test", subject: "x", html: "x", text: "x" })).rejects.toThrow(/535/);
  });
});
