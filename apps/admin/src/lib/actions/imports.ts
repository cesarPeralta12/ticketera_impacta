"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readSheet } from "read-excel-file/universal";
import { parseDelimited, parseImportTable } from "@ticketera/core";
import {
  DomainError,
  confirmImport,
  createImportDraft,
  discardImport,
  importOrdersToEmail,
  markTicketsEmailed,
  prisma,
  undoImport,
} from "@ticketera/db";
import { type FormState } from "@/lib/forms";
import { sendOrderTicketsEmail } from "@/lib/mail";
import { requireEditor, visibleEvent, type Staff } from "@/lib/session";
import { logAudit } from "@/lib/audit";

const MAX_FILE_BYTES = 5_000_000;
/** Correos por clic: cada uno lleva sus QR; el resto se envía con otro clic ("enviar los que faltan"). */
const EMAILS_PER_RUN = 50;

/** Importación de un evento que este usuario administra. */
async function ownBatch(staff: Staff, batchId: string) {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || !(await visibleEvent(staff, batch.eventId))) return null;
  return batch;
}

const batchPath = (batch: { id: string; eventId: string }) => `/eventos/${batch.eventId}/importar/${batch.id}`;

/** Celdas de Excel como texto: la fecha como 2026-11-20 y los números tal cual (150.5). */
function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell);
}

/** Paso 2: sube el archivo y lo revisa entero. Queda en borrador (sin ocupar cupo) y se abre la vista previa. */
export async function uploadImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const event = await visibleEvent(staff, String(formData.get("eventId") ?? ""));
  if (!event) return { error: "Evento no encontrado." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Elige el archivo de Excel (.xlsx) o CSV." } };
  if (file.size > MAX_FILE_BYTES) return { fieldErrors: { file: "El archivo supera 5 MB." } };
  if (/\.xls$/i.test(file.name)) {
    return { fieldErrors: { file: "Es un Excel antiguo (.xls): en Excel usa Archivo → Guardar como → Libro de Excel (.xlsx)." } };
  }

  let table: string[][];
  if (/\.xlsx$/i.test(file.name)) {
    const data = await file.arrayBuffer();
    try {
      // La hoja "Entradas" de la plantilla; si el archivo es otro, su primera hoja.
      const sheet = await readSheet(data, "Entradas").catch(() => readSheet(data));
      table = sheet.map((row) => row.map(cellText));
    } catch {
      return { fieldErrors: { file: "No se pudo leer el Excel. Revisa que sea un .xlsx válido." } };
    }
  } else if (/\.(csv|txt)$/i.test(file.name)) {
    table = parseDelimited(await file.text());
  } else {
    return { fieldErrors: { file: "Sube la plantilla en Excel (.xlsx) o un CSV." } };
  }

  const parsed = parseImportTable(table);
  if (parsed.total === 0) return { fieldErrors: { file: parsed.errors[0]?.message ?? "El archivo no tiene filas para importar." } };
  const batch = await createImportDraft({ eventId: event.id, staffId: staff.id, fileName: file.name, parsed });
  await logAudit({
    actorType: "staff",
    actorId: staff.id,
    action: "import.upload",
    entity: "ImportBatch",
    entityId: batch.id,
    data: { rows: batch.totalRows, valid: batch.validRows },
  });
  redirect(batchPath(batch));
}

/** Paso 3: confirma. Todo o nada: con una sola fila con error no se emite ninguna entrada. */
export async function confirmImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const batch = await ownBatch(staff, String(formData.get("batchId") ?? ""));
  if (!batch) return { error: "Importación no encontrada." };
  try {
    await confirmImport({ batchId: batch.id, staffId: staff.id });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/eventos/${batch.eventId}`);
  redirect(batchPath(batch));
}

export async function discardImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const batch = await ownBatch(staff, String(formData.get("batchId") ?? ""));
  if (!batch) return { error: "Importación no encontrada." };
  try {
    await discardImport({ batchId: batch.id, staffId: staff.id });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  redirect(`/eventos/${batch.eventId}/importar`);
}

/** Deshace el lote: anula las entradas que no se usaron y libera su cupo. */
export async function undoImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const batch = await ownBatch(staff, String(formData.get("batchId") ?? ""));
  if (!batch) return { error: "Importación no encontrada." };
  if (formData.get("confirm") !== "on") return { fieldErrors: { confirm: "Marca la casilla para confirmar que quieres anular estas entradas." } };
  try {
    const result = await undoImport({ batchId: batch.id, staffId: staff.id });
    revalidatePath(batchPath(batch));
    return {
      ok: true,
      message: `Se anularon ${result.cancelled} entrada(s).${result.used ? ` ${result.used} ya habían entrado y quedan como usadas.` : ""}`,
    };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

/** Envía las entradas por correo a quienes tienen correo y todavía no las recibieron (de a tandas). */
export async function emailImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const batch = await ownBatch(staff, String(formData.get("batchId") ?? ""));
  if (!batch) return { error: "Importación no encontrada." };
  if (batch.status !== "CONFIRMED") return { error: "Primero confirma la importación." };
  const orders = await importOrdersToEmail(batch.id, EMAILS_PER_RUN);
  if (orders.length === 0) return { ok: true, message: "No queda nadie por enviar." };
  const sent: string[] = [];
  let failed = 0;
  for (const order of orders) {
    if (await sendOrderTicketsEmail(order.code)) sent.push(order.id);
    else failed++;
  }
  await markTicketsEmailed(sent);
  await logAudit({ actorType: "staff", actorId: staff.id, action: "import.email", entity: "ImportBatch", entityId: batch.id, data: { sent: sent.length, failed } });
  revalidatePath(batchPath(batch));
  if (sent.length === 0) return { error: "No se pudo enviar ningún correo. Revisa la configuración del correo e inténtalo de nuevo." };
  return { ok: true, message: `Se enviaron ${sent.length} correo(s).${failed ? ` ${failed} fallaron: vuelve a intentarlo.` : ""}` };
}
