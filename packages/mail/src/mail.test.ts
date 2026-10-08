import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
