/**
 * CSV que Excel en español abre directo: separado por punto y coma y con BOM (sin él,
 * Excel muestra mal los acentos).
 */

type Cell = string | number | null | undefined;

/**
 * Lo que empieza con =, +, - o @ se antepone con ' para que Excel no lo ejecute como
 * fórmula: los nombres los escriben los compradores.
 */
export function csvCell(value: Cell) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvResponse(filename: string, header: string[], rows: Cell[][]) {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(";"));
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Montos en centavos → "120,50" (Excel en español lo toma como número). */
export const csvMoney = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
