/**
 * Plantillas de los correos de Impacta. HTML simple con estilos en línea (los clientes de correo no
 * cargan hojas de estilo) y una versión de texto para quien no ve HTML.
 */
import { formatCode, formatDateTime } from "@ticketera/core";
import type { Email, InlineImage } from "./send";

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const BRAND = "#0f8a6b";
const INK = "#14181b";

function button(href: string, label: string) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:10px;font-size:16px">${esc(label)}</a>`;
}

function layout(preheader: string, body: string) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f4f0;font-family:Arial,Helvetica,sans-serif;color:${INK}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
    <tr><td style="background:${INK};padding:18px 28px;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:.5px">IMPACTA<span style="color:#f5b700">.</span></td></tr>
    <tr><td style="padding:28px">${body}</td></tr>
    <tr><td style="padding:16px 28px;background:#fafaf7;color:#7a7d76;font-size:12px;line-height:1.5">
      Recibes este correo porque se usó esta dirección en Impacta. Si no fuiste tú, puedes ignorarlo.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export function verifyEmailMessage(input: { to: string; name: string; link: string; hours: number }): Email {
  const subject = "Confirma tu correo en Impacta";
  const html = layout(
    "Confirma tu correo para poder comprar entradas.",
    `<h1 style="margin:0 0 12px;font-size:24px">Confirma tu correo</h1>
     <p style="line-height:1.55">Hola ${esc(input.name)}, para comprar entradas necesitamos confirmar que este correo es tuyo. Ahí te enviaremos tus entradas.</p>
     <p style="margin:26px 0">${button(input.link, "Confirmar mi correo")}</p>
     <p style="color:#62655f;font-size:13px;line-height:1.5">El enlace vale ${input.hours} horas. Si el botón no funciona, copia esta dirección en el navegador:<br><span style="word-break:break-all">${esc(input.link)}</span></p>`,
  );
  const text = `Hola ${input.name},\n\nConfirma tu correo para poder comprar entradas en Impacta:\n${input.link}\n\nEl enlace vale ${input.hours} horas.`;
  return { to: input.to, subject, html, text };
}

export function resetPasswordMessage(input: { to: string; name: string; link: string; minutes: number }): Email {
  const subject = "Cambia tu contraseña de Impacta";
  const html = layout(
    "Pediste cambiar tu contraseña.",
    `<h1 style="margin:0 0 12px;font-size:24px">Cambia tu contraseña</h1>
     <p style="line-height:1.55">Hola ${esc(input.name)}, recibimos un pedido para cambiar la contraseña de tu cuenta.</p>
     <p style="margin:26px 0">${button(input.link, "Elegir una contraseña nueva")}</p>
     <p style="color:#62655f;font-size:13px;line-height:1.5">El enlace vale ${input.minutes} minutos y sirve una sola vez. Si no lo pediste tú, ignora este correo: tu contraseña no cambia.<br><br><span style="word-break:break-all">${esc(input.link)}</span></p>`,
  );
  const text = `Hola ${input.name},\n\nPara elegir una contraseña nueva entra aquí (vale ${input.minutes} minutos, una sola vez):\n${input.link}\n\nSi no lo pediste tú, ignora este correo.`;
  return { to: input.to, subject, html, text };
}

export function passwordChangedMessage(input: { to: string; name: string }): Email {
  const subject = "Tu contraseña de Impacta cambió";
  const html = layout(
    "Tu contraseña cambió.",
    `<h1 style="margin:0 0 12px;font-size:24px">Tu contraseña cambió</h1>
     <p style="line-height:1.55">Hola ${esc(input.name)}, te avisamos que la contraseña de tu cuenta se cambió hace un momento.</p>
     <p style="line-height:1.55;color:#b91c1c"><strong>¿No fuiste tú?</strong> Cambia tu contraseña de inmediato desde «Olvidé mi contraseña» y escríbenos.</p>`,
  );
  const text = `Hola ${input.name},\n\nLa contraseña de tu cuenta de Impacta se cambió hace un momento. Si no fuiste tú, cámbiala de inmediato desde "Olvidé mi contraseña".`;
  return { to: input.to, subject, html, text };
}

export type TicketMail = {
  code: string;
  typeName: string;
  seat: string | null;
  /** PNG del QR, si el tipo de entrada se lee por QR. */
  qrPng: Buffer | null;
};

/**
 * Entradas por correo: el QR de cada una viaja como imagen dentro del mensaje (sirve aunque el cliente
 * de correo no cargue imágenes remotas, y se puede mostrar en la puerta) y un botón lleva a la
 * versión siempre actualizada en el sitio.
 */
export function ticketsMessage(input: {
  to: string;
  buyerName: string;
  eventTitle: string;
  startsAt: Date;
  timezone: string;
  venueName: string;
  orderCode: string;
  orderUrl: string;
  tickets: TicketMail[];
}): Email {
  const when = formatDateTime(input.startsAt, input.timezone);
  const subject = `Tus entradas para ${input.eventTitle}`;
  const images: InlineImage[] = [];
  const cards = input.tickets
    .map((t, i) => {
      let qr = "";
      if (t.qrPng) {
        const cid = `qr-${i + 1}`;
        images.push({ cid, filename: `entrada-${t.code}.png`, content: t.qrPng, contentType: "image/png" });
        qr = `<img src="cid:${cid}" width="200" height="200" alt="QR de la entrada ${esc(formatCode(t.code))}" style="display:block;margin:12px auto;border:0">`;
      }
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e1dfd7;border-radius:12px;margin:14px 0"><tr><td align="center" style="padding:16px">
        <div style="font-size:12px;color:#7a7d76;text-transform:uppercase;letter-spacing:1px">Entrada ${i + 1} de ${input.tickets.length}</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px">${esc(t.typeName)}</div>
        ${t.seat ? `<div style="font-size:15px;font-weight:700;margin-top:2px">${esc(t.seat)}</div>` : ""}
        ${qr}
        <div style="font-family:Consolas,monospace;font-size:16px;letter-spacing:2px">${esc(formatCode(t.code))}</div>
      </td></tr></table>`;
    })
    .join("");

  const html = layout(
    `${input.tickets.length} entrada(s) para ${input.eventTitle}`,
    `<h1 style="margin:0 0 6px;font-size:24px">¡Listo, ${esc(input.buyerName.split(" ")[0] ?? "")}! Tus entradas</h1>
     <p style="margin:0 0 4px;font-size:18px;font-weight:700">${esc(input.eventTitle)}</p>
     <p style="margin:0;color:#62655f">${esc(when)} · ${esc(input.venueName)}</p>
     ${cards}
     <p style="margin:22px 0;text-align:center">${button(input.orderUrl, "Ver mis entradas")}</p>
     <p style="color:#62655f;font-size:13px;line-height:1.55">Cada entrada vale para <strong>un solo ingreso</strong> y está a tu nombre: lleva tu <strong>carnet de identidad</strong>, que se puede pedir en la puerta. No compartas el QR por redes: quien llegue primero con él entra. El botón de arriba abre siempre la versión actualizada. Compra ${esc(input.orderCode)}.</p>`,
  );
  const text =
    `¡Listo, ${input.buyerName}! Tus entradas para ${input.eventTitle}\n${when} · ${input.venueName}\n\n` +
    input.tickets.map((t, i) => `Entrada ${i + 1}: ${t.typeName}${t.seat ? ` · ${t.seat}` : ""} · ${formatCode(t.code)}`).join("\n") +
    `\n\nVer mis entradas: ${input.orderUrl}\n\nLleva tu carnet de identidad. Cada entrada vale para un solo ingreso.`;
  return { to: input.to, subject, html, text, images };
}
