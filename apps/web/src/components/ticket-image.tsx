"use client";

import { useState } from "react";

/** Lo que va en la imagen de una entrada (el QR es el mismo que se ve en pantalla). */
export type TicketImageData = {
  /** Código con formato (XXXXX-XXXXX). */
  code: string;
  eventTitle: string;
  when: string;
  venue: string;
  holder?: string | null;
  typeName: string;
  /** Butaca o mesa, puerta, zonas, reingreso…: una línea cada una. */
  lines: string[];
  qrSvg?: string | null;
  barcodeSvg?: string | null;
};

const W = 1080;
const PAD = 80;
const NAVY = "#192438";
const MUTED = "#60718B";
const CARD = "#F5F6F8";
const AMBER = "#F5B700";
const GREEN = "#16846C";

/** El SVG como imagen, con ancho y alto explícitos (sin tamaño, algunos navegadores no lo dibujan). */
function svgImage(svg: string, width: number, height: number) {
  const sized = svg.replace(/<svg\b([^>]*)>/, (_, attrs: string) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")} width="${width}" height="${height}">`);
  const img = new Image(width, height);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
  return img.decode().then(() => img);
}

/** Corta el texto en renglones que entran en `max` píxeles (como mucho `limit`; el último termina en "…"). */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, limit = 3) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > limit) {
    lines.length = limit;
    lines[limit - 1] = `${lines[limit - 1]!.replace(/\s+\S*$/, "")}…`;
  }
  return lines;
}

/**
 * Dibuja la entrada en un PNG (1080 px de ancho): arriba el evento, después a nombre de quién, el tipo, el lugar y el
 * QR grande sobre blanco, para que la puerta la lea bien también desde la galería del celular.
 */
async function drawTicket(t: TicketImageData): Promise<Blob> {
  await document.fonts.ready;
  const font = getComputedStyle(document.body).fontFamily;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 2600; // se recorta al final, según lo que ocupó
  const ctx = canvas.getContext("2d")!;
  const center = W / 2;
  const text = (s: string, y: number, size: number, color: string, weight = 400, family = font) => {
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.fillStyle = color;
    ctx.fillText(s, center, y);
  };
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Encabezado: marca, evento, cuándo y dónde.
  ctx.font = `700 64px ${font}`;
  const title = wrap(ctx, t.eventTitle, W - 2 * PAD);
  ctx.font = `400 34px ${font}`;
  const place = wrap(ctx, `${t.when} · ${t.venue}`, W - 2 * PAD, 2);
  const headerHeight = 150 + title.length * 76 + place.length * 46 + 50;
  ctx.fillStyle = CARD;
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, headerHeight);
  text("iPass", 110, 44, AMBER, 800);
  let y = 200;
  /** Escribe un renglón centrado y baja `step` píxeles. */
  const put = (s: string, size: number, color: string, weight: number, step: number) => {
    text(s, y, size, color, weight);
    y += step;
  };
  for (const l of title) put(l, 64, "#FFFFFF", 700, 76);
  y += 6;
  for (const l of place) put(l, 34, "#C3CCDD", 400, 46);

  // Datos de la entrada.
  y = headerHeight + 90;
  if (t.holder) put(t.holder, 40, NAVY, 600, 70);
  ctx.font = `700 60px ${font}`;
  for (const l of wrap(ctx, t.typeName, W - 2 * PAD, 2)) put(l, 60, NAVY, 700, 72);
  ctx.font = `600 34px ${font}`;
  for (const [i, line] of t.lines.entries()) {
    for (const l of wrap(ctx, line, W - 2 * PAD, 2)) put(l, 34, i === 0 ? GREEN : MUTED, 600, 46);
  }

  // El QR (o el código de barras) sobre blanco, grande.
  y += 30;
  if (t.qrSvg) {
    const box = 760;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.roundRect(center - box / 2, y, box, box, 36);
    ctx.fill();
    const qr = await svgImage(t.qrSvg, 680, 680);
    ctx.drawImage(qr, center - 340, y + 40, 680, 680);
    y += box + 40;
  }
  if (t.barcodeSvg) {
    const view = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(t.barcodeSvg);
    const width = W - 2 * PAD;
    const height = view ? Math.round((width * Number(view[2])) / Number(view[1])) : 200;
    const barcode = await svgImage(t.barcodeSvg, width, height);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(PAD - 20, y - 20, width + 40, height + 40);
    ctx.drawImage(barcode, PAD, y, width, height);
    y += height + 60;
  }

  y += 40;
  text(t.code, y, 56, NAVY, 600, "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
  y += 70;
  ctx.font = `400 28px ${font}`;
  for (const l of wrap(ctx, "Presenta este QR en la puerta. Es tu entrada: no la compartas.", W - 2 * PAD, 2)) put(l, 28, MUTED, 400, 40);

  const out = document.createElement("canvas");
  out.width = W;
  out.height = y + PAD - 20;
  out.getContext("2d")!.drawImage(canvas, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo crear la imagen.");
  return blob;
}

/** Botón "Descargar como imagen": en el celular abre "Compartir" (para guardarla en Fotos); en la computadora la descarga. */
export function DownloadTicketButton({ ticket }: { ticket: TicketImageData }) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");

  async function download() {
    setState("working");
    try {
      const blob = await drawTicket(ticket);
      const name = `entrada-${ticket.code}.png`;
      const file = new File([blob], name, { type: "image/png" });
      if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: ticket.eventTitle });
        } catch (error) {
          // Cerró el menú de compartir sin elegir: no es un error.
          if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={download}
        disabled={state === "working"}
        className="inline-flex items-center gap-1.5 rounded-full border border-[#192438]/25 px-4 py-1.5 text-xs font-semibold text-[#192438] transition-colors hover:bg-white disabled:opacity-60"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3v10m0 0 4-4m-4 4-4-4M4 16h12" />
        </svg>
        {state === "working" ? "Preparando…" : "Descargar como imagen"}
      </button>
      {state === "error" && <p className="mt-1 text-xs text-[#C62842]">No se pudo crear la imagen: haz una captura de pantalla.</p>}
    </div>
  );
}
