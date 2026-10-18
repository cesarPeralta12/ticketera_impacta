import {
  PDFDocument,
  StandardFonts,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import QRCode from "qrcode";
import { code128Widths } from "@ticketera/core";

/**
 * Entradas impresas en PDF (vectorial: el QR y el código de barras no se pixelan). Formatos:
 * - Carta x3 y A4 x3 / x4: varias entradas por hoja, con talón de control a la izquierda y línea de corte.
 * - Térmica 80 mm: una entrada por tiquete, talón abajo.
 * - Imprenta: una entrada por página con 2 mm de sangrado y marcas de corte (el arte llega hasta el sangrado).
 * Textos y QR quedan a 4 mm o más del borde de corte.
 */
export const PAPER_FORMATS = ["carta3", "a4x3", "a4x4", "termica", "imprenta"] as const;
export type PaperFormat = (typeof PAPER_FORMATS)[number];

export const PAPER_LABEL: Record<PaperFormat, string> = {
  carta3: "Carta · 3 por hoja",
  a4x3: "A4 · 3 por hoja",
  a4x4: "A4 · 4 por hoja",
  termica: "Térmica 80 mm",
  imprenta: "Imprenta (sangrado y marcas de corte)",
};

export type PrintableTicket = {
  code: string;
  /** Lo que lleva el QR (el código firmado, igual que las demás entradas). */
  qrPayload: string;
  serial: string | null;
  orgName: string;
  eventTitle: string;
  /** "Sábado, 19 de diciembre" */
  dayLine: string;
  /** "Abren las puertas 22:00 · Empieza la noche 23:00" */
  timeLine: string;
  venueLine: string;
  typeName: string;
  priceLabel: string | null;
  holder: string | null;
  seat: string | null;
  conditions: string[];
  barcode: boolean;
};

export type TicketArtImage = { bytes: Uint8Array; mimeType: string } | null;

const MM = 72 / 25.4;
const mm = (v: number) => v * MM;
const SAFE = mm(4);
const INK = rgb(0.08, 0.09, 0.1);
const MUTED = rgb(0.38, 0.39, 0.37);

type Box = { x: number; y: number; w: number; h: number };
type Fonts = { regular: PDFFont; bold: PDFFont; mono: PDFFont };

/** Helvetica (WinAnsi) no tiene todos los caracteres: se cambian los comunes y se quita el resto (emojis…). */
function safe(text: string): string {
  return text
    .replace(/[→⟶]/g, "->")
    .replace(/[•]/g, "·")
    .normalize("NFC")
    .replace(/[^ -~ -ÿ–—‘’“”…€]/g, "");
}

/** Corta un texto en líneas que entren en el ancho (como mucho `maxLines`, con "…" si no entra). */
function wrap(text: string, font: PDFFont, size: number, width: number, maxLines: number): string[] {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    let last = lines[maxLines - 1]!;
    while (last.length > 1 && font.widthOfTextAtSize(`${last}…`, size) > width) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** Escribe líneas de arriba hacia abajo desde `top`; devuelve dónde terminó. */
function lines(page: PDFPage, list: string[], x: number, top: number, font: PDFFont, size: number, color = INK, gap = 1.25): number {
  let y = top;
  for (const text of list) {
    y -= size;
    page.drawText(text, { x, y, size, font, color });
    y -= size * (gap - 1);
  }
  return y;
}

function drawQr(page: PDFPage, payload: string, x: number, y: number, size: number) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
  for (let row = 0; row < n; row++) {
    let start = -1;
    for (let col = 0; col <= n; col++) {
      const dark = col < n && qr.modules.get(row, col);
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        page.drawRectangle({
          x: x + (quiet + start) * cell,
          y: y + size - (quiet + row + 1) * cell,
          width: (col - start) * cell,
          height: cell,
          color: INK,
        });
        start = -1;
      }
    }
  }
}

function drawBarcode(page: PDFPage, text: string, x: number, y: number, width: number, height: number) {
  const widths = code128Widths(text);
  const modules = widths.reduce((a, b) => a + b, 0);
  const unit = width / modules;
  let cx = x;
  widths.forEach((w, i) => {
    if (i % 2 === 0) page.drawRectangle({ x: cx, y, width: w * unit, height, color: INK });
    cx += w * unit;
  });
}

function dashedLine(page: PDFPage, x1: number, y1: number, x2: number, y2: number) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.6, color: MUTED, dashArray: [3, 3] });
}

/** Arte de fondo ajustado para cubrir la caja (se recorta lo que sobra, centrado). */
function drawCover(page: PDFPage, image: PDFImage, box: Box) {
  const scale = Math.max(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  // Recorte: guarda el estado, limita el dibujo a la caja (q / re / W n), dibuja y lo restaura.
  page.pushOperators(pushGraphicsState(), rectangle(box.x, box.y, box.w, box.h), clip(), endPath());
  page.drawImage(image, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, width: w, height: h });
  page.pushOperators(popGraphicsState());
}

/** Entrada horizontal (formatos de hoja e imprenta): talón a la izquierda, datos al centro y QR a la derecha. */
function drawWideTicket(page: PDFPage, t: PrintableTicket, box: Box, fonts: Fonts, art: PDFImage | null, opts: { stub: boolean }) {
  const stubW = opts.stub ? mm(38) : 0;
  const main: Box = { x: box.x + stubW, y: box.y, w: box.w - stubW, h: box.h };
  if (art) drawCover(page, art, main);

  // Talón de control (se lo queda el organizador o el vendedor).
  if (opts.stub) {
    const sx = box.x + SAFE;
    let y = box.y + box.h - SAFE;
    y = lines(page, wrap(t.orgName, fonts.regular, 7, stubW - 2 * SAFE, 1), sx, y, fonts.regular, 7, MUTED);
    y -= mm(2);
    y = lines(page, ["TALÓN"], sx, y, fonts.bold, 8, MUTED);
    y -= mm(1);
    if (t.serial) y = lines(page, [safe(t.serial)], sx, y, fonts.bold, 15);
    y = lines(page, wrap(t.typeName, fonts.bold, 8, stubW - 2 * SAFE, 2), sx, y - mm(1), fonts.bold, 8);
    y = lines(page, wrap(t.eventTitle, fonts.regular, 7, stubW - 2 * SAFE, 2), sx, y - mm(1), fonts.regular, 7, MUTED);
    lines(page, wrap(t.dayLine, fonts.regular, 7, stubW - 2 * SAFE, 2), sx, y - mm(1), fonts.regular, 7, MUTED);
    lines(page, [safe(t.code.replace(/(.{5})(.{5})/, "$1-$2"))], sx, box.y + SAFE + 8, fonts.mono, 7, MUTED);
    dashedLine(page, box.x + stubW, box.y + mm(2), box.x + stubW, box.y + box.h - mm(2));
  }

  // QR (2 cm o más) a la derecha, con el código legible debajo.
  const qrSize = Math.min(main.h - 2 * SAFE - 12, mm(34));
  const qrX = main.x + main.w - SAFE - qrSize;
  const qrY = main.y + main.h - SAFE - qrSize;
  drawQr(page, t.qrPayload, qrX, qrY, qrSize);
  const code = t.code.replace(/(.{5})(.{5})/, "$1-$2");
  const codeW = fonts.mono.widthOfTextAtSize(code, 9);
  if (art) page.drawRectangle({ x: qrX, y: qrY - 13, width: qrSize, height: 13, color: rgb(1, 1, 1) });
  page.drawText(code, { x: qrX + (qrSize - codeW) / 2, y: qrY - 10, size: 9, font: fonts.mono, color: INK });

  // Datos a la izquierda del QR: primero se arman los renglones para saber cuánto miden (con arte de fondo, el
  // recuadro blanco cubre solo el texto y el resto del diseño se ve).
  const tx = main.x + SAFE;
  const textW = qrX - tx - mm(4);
  type Block = { text: string[]; font: PDFFont; size: number; color?: ReturnType<typeof rgb>; gap?: number; before?: number };
  const blocks: Block[] = [
    { text: wrap(t.orgName, fonts.regular, 7, textW, 1), font: fonts.regular, size: 7, color: MUTED },
    { text: wrap(t.eventTitle, fonts.bold, 13, textW, 2), font: fonts.bold, size: 13, gap: 1.15, before: 2 },
    { text: wrap(t.dayLine, fonts.bold, 9, textW, 1), font: fonts.bold, size: 9, before: 1 },
    { text: wrap(t.timeLine, fonts.regular, 8, textW, 2), font: fonts.regular, size: 8, color: MUTED },
    { text: wrap(t.venueLine, fonts.regular, 8, textW, 2), font: fonts.regular, size: 8, color: MUTED },
    { text: wrap(`${t.typeName}${t.priceLabel ? ` · ${t.priceLabel}` : ""}`, fonts.bold, 10, textW, 1), font: fonts.bold, size: 10, before: 3 },
    ...(t.seat ? [{ text: wrap(t.seat, fonts.bold, 9, textW, 1), font: fonts.bold, size: 9 }] : []),
    ...(t.holder ? [{ text: wrap(t.holder, fonts.regular, 8, textW, 1), font: fonts.regular, size: 8, color: MUTED }] : []),
    ...(t.conditions.length ? [{ text: wrap(t.conditions.join(" · "), fonts.regular, 7, textW, 2), font: fonts.regular, size: 7, color: MUTED, before: 1 }] : []),
  ];
  const textTop = main.y + main.h - SAFE;
  const textHeight = blocks.reduce((h, b) => h + (b.before ?? 0) + b.text.length * b.size * (b.gap ?? 1.25), 0);
  if (art) {
    page.drawRectangle({ x: tx - mm(2), y: textTop - textHeight - mm(2), width: textW + mm(4), height: textHeight + mm(4), color: rgb(1, 1, 1), opacity: 0.88 });
  }
  let y = textTop;
  for (const b of blocks) y = lines(page, b.text, tx, y - (b.before ?? 0), b.font, b.size, b.color ?? INK, b.gap ?? 1.25);

  // Serie grande abajo a la izquierda y código de barras (si la entrada se lee con lector láser).
  const bottom = main.y + SAFE;
  const serialW = t.serial ? fonts.bold.widthOfTextAtSize(safe(t.serial), 16) + mm(4) : 0;
  const bw = Math.min(mm(55), textW - serialW);
  const showBarcode = t.barcode && bw > mm(25) && y - bottom > mm(9);
  if (art && (t.serial || showBarcode)) {
    page.drawRectangle({ x: tx - mm(2), y: bottom - mm(2), width: serialW + (showBarcode ? bw : 0) + mm(3), height: mm(10), color: rgb(1, 1, 1), opacity: 0.88 });
  }
  if (t.serial) page.drawText(safe(t.serial), { x: tx, y: bottom, size: 16, font: fonts.bold, color: INK });
  if (showBarcode) drawBarcode(page, t.code, tx + serialW, bottom, bw, mm(8));
}

/** Tiquete térmico de 80 mm: todo en columna, talón abajo. */
function drawThermal(page: PDFPage, t: PrintableTicket, box: Box, fonts: Fonts) {
  const tx = box.x + mm(3);
  const w = box.w - mm(6);
  let y = box.y + box.h - mm(3);
  y = lines(page, wrap(t.orgName, fonts.regular, 7, w, 1), tx, y, fonts.regular, 7, MUTED);
  y = lines(page, wrap(t.eventTitle, fonts.bold, 12, w, 2), tx, y - 1, fonts.bold, 12, INK, 1.15);
  y = lines(page, wrap(t.dayLine, fonts.bold, 8, w, 1), tx, y, fonts.bold, 8);
  y = lines(page, wrap(t.timeLine, fonts.regular, 7, w, 2), tx, y, fonts.regular, 7);
  y = lines(page, wrap(t.venueLine, fonts.regular, 7, w, 2), tx, y, fonts.regular, 7);
  y = lines(page, wrap(`${t.typeName}${t.priceLabel ? ` · ${t.priceLabel}` : ""}`, fonts.bold, 10, w, 1), tx, y - 2, fonts.bold, 10);
  if (t.seat) y = lines(page, wrap(t.seat, fonts.bold, 9, w, 1), tx, y, fonts.bold, 9);
  if (t.holder) y = lines(page, wrap(t.holder, fonts.regular, 7, w, 1), tx, y, fonts.regular, 7);
  const qrSize = mm(46);
  drawQr(page, t.qrPayload, box.x + (box.w - qrSize) / 2, y - qrSize - 2, qrSize);
  y -= qrSize + 4;
  const code = t.code.replace(/(.{5})(.{5})/, "$1-$2");
  page.drawText(code, { x: box.x + (box.w - fonts.mono.widthOfTextAtSize(code, 9)) / 2, y: y - 9, size: 9, font: fonts.mono, color: INK });
  y -= 13;
  if (t.serial) {
    page.drawText(safe(t.serial), { x: box.x + (box.w - fonts.bold.widthOfTextAtSize(safe(t.serial), 16)) / 2, y: y - 16, size: 16, font: fonts.bold, color: INK });
    y -= 20;
  }
  if (t.conditions.length) y = lines(page, wrap(t.conditions.join(" · "), fonts.regular, 6.5, w, 2), tx, y, fonts.regular, 6.5);
  // Talón
  const stubTop = box.y + mm(16);
  dashedLine(page, box.x + mm(2), stubTop, box.x + box.w - mm(2), stubTop);
  lines(page, [`TALÓN · ${safe(t.serial ?? code)}`], tx, stubTop - mm(2), fonts.bold, 9);
  lines(page, wrap(`${t.typeName} · ${t.eventTitle}`, fonts.regular, 7, w, 2), tx, stubTop - mm(6), fonts.regular, 7);
}

function cropMarks(page: PDFPage, trim: Box) {
  const len = mm(5);
  const off = mm(3);
  const marks: [number, number, number, number][] = [];
  for (const x of [trim.x, trim.x + trim.w]) {
    marks.push([x, trim.y - off, x, trim.y - off - len]);
    marks.push([x, trim.y + trim.h + off, x, trim.y + trim.h + off + len]);
  }
  for (const y of [trim.y, trim.y + trim.h]) {
    marks.push([trim.x - off, y, trim.x - off - len, y]);
    marks.push([trim.x + trim.w + off, y, trim.x + trim.w + off + len, y]);
  }
  for (const [x1, y1, x2, y2] of marks) page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.25, color: rgb(0, 0, 0) });
}

/** Arma el PDF. Lo grande (cientos de entradas) se dibuja igual: son vectores. */
export async function ticketsPdf(tickets: PrintableTicket[], format: PaperFormat, artImage: TicketArtImage = null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Entradas · ${tickets[0]?.eventTitle ?? "Impacta"}`);
  pdf.setCreator("Impacta");
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };
  const art = artImage ? (artImage.mimeType === "image/png" ? await pdf.embedPng(artImage.bytes) : await pdf.embedJpg(artImage.bytes)) : null;

  if (format === "termica") {
    for (const t of tickets) {
      const page = pdf.addPage([mm(80), mm(150)]);
      drawThermal(page, t, { x: 0, y: 0, w: mm(80), h: mm(150) }, fonts);
    }
  } else if (format === "imprenta") {
    const trimW = mm(200);
    const trimH = mm(80);
    const bleed = mm(2);
    const slug = mm(10);
    for (const t of tickets) {
      const page = pdf.addPage([trimW + 2 * (bleed + slug), trimH + 2 * (bleed + slug)]);
      const trim: Box = { x: bleed + slug, y: bleed + slug, w: trimW, h: trimH };
      // El arte llega hasta el sangrado; los textos quedan dentro del área segura.
      if (art) drawCover(page, art, { x: slug, y: slug, w: trimW + 2 * bleed, h: trimH + 2 * bleed });
      drawWideTicket(page, t, trim, fonts, null, { stub: true });
      cropMarks(page, trim);
    }
  } else {
    const [pageW, pageH] = format === "carta3" ? [mm(215.9), mm(279.4)] : [mm(210), mm(297)];
    const perPage = format === "a4x4" ? 4 : 3;
    const h = pageH / perPage;
    for (let i = 0; i < tickets.length; i += perPage) {
      const page = pdf.addPage([pageW, pageH]);
      tickets.slice(i, i + perPage).forEach((t, k) => {
        const box: Box = { x: 0, y: pageH - (k + 1) * h, w: pageW, h };
        drawWideTicket(page, t, box, fonts, art, { stub: true });
        if (k < perPage - 1) dashedLine(page, mm(2), box.y, pageW - mm(2), box.y);
      });
    }
  }
  return pdf.save();
}
