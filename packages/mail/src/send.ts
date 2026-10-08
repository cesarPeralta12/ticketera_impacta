/**
 * Envío de correo. Un solo punto de salida para toda la plataforma:
 *
 * - MAIL_PROVIDER=resend  → API de Resend (necesita RESEND_API_KEY y MAIL_FROM de un dominio verificado).
 * - MAIL_PROVIDER=console → desarrollo: no envía nada; escribe el correo en `.dev-mail/` (HTML con las
 *   imágenes incluidas) y muestra el enlace principal en la consola del servidor.
 *
 * Sin MAIL_PROVIDER, se usa Resend si hay RESEND_API_KEY y consola si no. Cambiar de proveedor
 * (Brevo, Amazon SES…) es agregar otra función aquí: nada más del sistema lo sabe.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type InlineImage = {
  /** Identificador para referenciarla en el HTML: <img src="cid:qr-1">. */
  cid: string;
  filename: string;
  content: Buffer;
  contentType: string;
};

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  images?: InlineImage[];
};

export type SendResult = { provider: "resend" | "console"; id?: string };

export class MailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MailError";
  }
}

const DEFAULT_FROM = "Impacta <onboarding@resend.dev>";

function providerName(): "resend" | "console" {
  const chosen = process.env.MAIL_PROVIDER?.toLowerCase();
  if (chosen === "resend" || chosen === "console") return chosen;
  return process.env.RESEND_API_KEY ? "resend" : "console";
}

async function sendWithResend(email: Email): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new MailError("Falta RESEND_API_KEY para enviar correos con Resend.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || DEFAULT_FROM,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      // Las imágenes viajan dentro del correo (no dependen de que el cliente cargue imágenes remotas).
      attachments: email.images?.map((img) => ({
        filename: img.filename,
        content: img.content.toString("base64"),
        content_id: img.cid,
        content_type: img.contentType,
      })),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new MailError(`Resend respondió ${response.status}: ${detail.slice(0, 300)}`, response.status);
  }
  const body = (await response.json().catch(() => ({}))) as { id?: string };
  return { provider: "resend", id: body.id };
}

async function sendToConsole(email: Email): Promise<SendResult> {
  // Para poder abrir el HTML en el navegador, las imágenes "cid:" pasan a datos incrustados.
  let html = email.html;
  for (const img of email.images ?? []) {
    html = html.replaceAll(`cid:${img.cid}`, `data:${img.contentType};base64,${img.content.toString("base64")}`);
  }
  const dir = process.env.DEV_MAIL_DIR || path.join(process.cwd(), ".dev-mail");
  const safeTo = email.to.replace(/[^a-z0-9@._-]/gi, "_");
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}__${safeTo}.html`);
  await mkdir(dir, { recursive: true });
  await writeFile(file, `<!-- Para: ${email.to} · Asunto: ${email.subject} -->\n${html}`, "utf8");
  const link = /https?:\/\/[^\s"'<>]+/.exec(email.text)?.[0];
  console.info(`[correo de desarrollo] Para: ${email.to} · ${email.subject}${link ? ` · ${link}` : ""} · ${file}`);
  return { provider: "console" };
}

/** Envía un correo. Lanza MailError si el proveedor lo rechaza: quien llama decide si eso detiene el flujo. */
export async function sendEmail(email: Email): Promise<SendResult> {
  return providerName() === "resend" ? sendWithResend(email) : sendToConsole(email);
}

/** Envía sin lanzar: para avisos que no deben romper la operación principal (la compra ya está pagada). */
export async function sendEmailSafely(email: Email): Promise<boolean> {
  try {
    await sendEmail(email);
    return true;
  } catch (error) {
    console.error(`[correo] No se pudo enviar "${email.subject}" a ${email.to}:`, error instanceof Error ? error.message : error);
    return false;
  }
}
