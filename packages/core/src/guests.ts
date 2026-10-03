/**
 * Lista de invitados pegada desde Excel (columnas separadas por tabulador) o subida como CSV
 * (coma o punto y coma, como lo guarda Excel en español). Una persona por línea:
 * nombre y, opcionalmente, email y documento, en cualquier orden después del nombre.
 */
export type ParsedGuest = { name: string; email?: string; document?: string };

export const MAX_GUESTS_PER_UPLOAD = 2000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADER_NAMES = new Set(["nombre", "nombres", "nombre completo", "name", "invitado", "invitados"]);

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

function splitLine(line: string): string[] {
  const separator = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
  return line.split(separator).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1").trim());
}

export function parseGuestList(text: string): { guests: ParsedGuest[]; errors: string[] } {
  const guests: ParsedGuest[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);

  let first = true;
  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    if (raw.trim() === "") return;
    const cells = splitLine(raw).filter((cell, i) => i === 0 || cell !== "");
    if (first) {
      first = false;
      if (HEADER_NAMES.has(normalize(cells[0] ?? ""))) return;
    }

    const name = (cells[0] ?? "").replace(/\s+/g, " ");
    if (name.length < 2) {
      errors.push(`Línea ${lineNo}: falta el nombre.`);
      return;
    }
    const rest = cells.slice(1);
    const emailCell = rest.find((cell) => cell.includes("@"));
    const document = rest.find((cell) => cell !== emailCell);
    if (emailCell !== undefined && !EMAIL.test(emailCell)) {
      errors.push(`Línea ${lineNo}: email inválido (${emailCell}).`);
      return;
    }

    const email = emailCell?.toLowerCase();
    const key = [normalize(name), email ?? "", document ?? ""].join("|");
    const previous = seen.get(key);
    if (previous !== undefined) {
      errors.push(`Línea ${lineNo}: ${name} está repetido (línea ${previous}).`);
      return;
    }
    seen.set(key, lineNo);
    guests.push({ name, ...(email ? { email } : {}), ...(document ? { document } : {}) });
  });

  if (guests.length > MAX_GUESTS_PER_UPLOAD) {
    errors.push(`Máximo ${MAX_GUESTS_PER_UPLOAD} invitados por carga (la lista tiene ${guests.length}).`);
  }
  return { guests, errors };
}
