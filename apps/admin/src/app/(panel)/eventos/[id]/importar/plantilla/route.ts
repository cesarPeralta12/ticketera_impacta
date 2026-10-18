import { IMPORT_COLUMNS, MAX_IMPORT_ROWS, formatMoney, peopleIn } from "@ticketera/core";
import { getImportContext, prisma } from "@ticketera/db";
import { ROLES, can, currentStaff, visibleEvent } from "@/lib/session";
import { columnName, xlsx } from "@/lib/xlsx";

type Props = { params: Promise<{ id: string }> };

/**
 * Plantilla .xlsx para importar entradas de un evento: hoja "Entradas" con los títulos y listas desplegables de
 * función y tipo de entrada; hoja "Ayuda" con esas listas, qué va en cada columna y cómo se ubica cada tipo.
 */
export async function GET(_req: Request, { params }: Props) {
  const staff = await currentStaff();
  if (!staff || !can(staff, ROLES.manage)) return Response.json({ error: "Sin permiso." }, { status: 403 });
  const event = await visibleEvent(staff, (await params).id);
  if (!event) return Response.json({ error: "Evento no encontrado." }, { status: 404 });

  const sessions = (await getImportContext(prisma, event.id)).filter((s) => !s.cancelled);
  const typeNames = [...new Set(sessions.flatMap((s) => s.ticketTypes.filter((t) => t.qrMode === "STATIC").map((t) => t.name)))];
  const prices = await prisma.ticketType.findMany({
    where: { id: { in: sessions.flatMap((s) => s.ticketTypes.map((t) => t.id)) } },
    select: { id: true, unitAmount: true, currency: true },
  });
  const priceOf = new Map(prices.map((p) => [p.id, formatMoney(p.unitAmount, p.currency)]));

  const column = (key: (typeof IMPORT_COLUMNS)[number]["key"]) => columnName(IMPORT_COLUMNS.findIndex((c) => c.key === key));
  const last = MAX_IMPORT_ROWS + 1;
  const entries = {
    name: "Entradas",
    header: true,
    rows: [IMPORT_COLUMNS.map((c) => c.header)],
    widths: [38, 24, 30, 14, 30, 16, 18],
    lists: [
      ...(sessions.length > 0
        ? [{ range: `${column("session")}2:${column("session")}${last}`, source: `Ayuda!$A$2:$A$${sessions.length + 1}`, prompt: "Elige la función de la lista." }]
        : []),
      ...(typeNames.length > 0
        ? [{ range: `${column("type")}2:${column("type")}${last}`, source: `Ayuda!$B$2:$B$${typeNames.length + 1}`, prompt: "Elige el tipo de entrada." }]
        : []),
    ],
  };

  // Ayuda: A = funciones, B = tipos (de ahí salen las listas), D-E = columnas, G-K = tipos por función.
  const help: (string | number)[][] = [["Funciones", "Tipos de entrada", "", "Columna", "Qué va", "", "Función", "Tipo de entrada", "Cómo se ubica", "Personas", "Precio en la web"]];
  const set = (row: number, col: number, value: string | number) => {
    while (help.length <= row) help.push([]);
    help[row]![col] = value;
  };
  sessions.forEach((s, i) => set(i + 1, 0, s.label));
  typeNames.forEach((name, i) => set(i + 1, 1, name));
  IMPORT_COLUMNS.forEach((c, i) => {
    set(i + 1, 3, c.header);
    set(i + 1, 4, c.note);
  });
  const notes = [
    "Una fila por persona; en una mesa, una fila por mesa (se emite una entrada por persona).",
    `Hasta ${MAX_IMPORT_ROWS} filas por archivo. Antes de importar ves una vista previa con los errores de cada fila.`,
    "Las entradas importadas ocupan el cupo igual que las vendidas en la web.",
    "Las de QR dinámico no se importan (solo se venden online).",
  ];
  notes.forEach((n, i) => set(IMPORT_COLUMNS.length + 2 + i, 3, n));
  let row = 1;
  for (const s of sessions) {
    for (const t of s.ticketTypes) {
      const seated = t.section?.seatingMode === "RESERVED";
      set(row, 6, s.label);
      set(row, 7, t.name);
      set(
        row,
        8,
        t.qrMode === "DYNAMIC"
          ? "No se importa (QR dinámico)"
          : seated
            ? `${t.kind === "TABLE" ? "Mesa del mapa" : "Butaca"} de ${t.section!.name} (obligatoria)`
            : t.kind === "TABLE"
              ? "Mesa: número opcional (vacío = la siguiente)"
              : "Entrada general (sin butaca)",
      );
      set(row, 9, peopleIn(t));
      set(row, 10, priceOf.get(t.id) ?? "");
      row++;
    }
  }

  const file = xlsx([entries, { name: "Ayuda", header: true, rows: help, widths: [44, 24, 4, 20, 70, 4, 44, 24, 40, 10, 16] }]);
  const name = `importar-${event.slug}`.replace(/[^a-z0-9-]/gi, "").slice(0, 60);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
