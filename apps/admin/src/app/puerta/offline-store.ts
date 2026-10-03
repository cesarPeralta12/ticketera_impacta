/**
 * Almacenamiento del celular de puerta (IndexedDB): la lista de entradas descargada y las
 * lecturas que todavía no se subieron. Sobrevive a recargar la página y a quedarse sin
 * batería; se borra al cerrar sesión.
 */
import type { SessionSyncData } from "@ticketera/db";

const DB_NAME = "impacta-puerta";
const STORE = "kv";

export type DoorData = SessionSyncData;
export type DoorTicket = DoorData["tickets"][number];

export type RejectionResult = "ALREADY_USED" | "NOT_FOUND" | "CANCELLED" | "WRONG_SESSION" | "WRONG_GATE" | "INVALID";
export type ScanResult = "ACCEPTED" | RejectionResult;

/** Lectura hecha sin conexión, a subir cuando vuelva internet. */
export type PendingScan = {
  id: string;
  raw: string;
  scannedAt: string;
  offline: true;
  offlineResult?: RejectionResult;
  accessPointId?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const loadData = (sessionId: string) => run<DoorData | undefined>("readonly", (s) => s.get(`data:${sessionId}`));
export const saveData = (sessionId: string, data: DoorData) => run("readwrite", (s) => s.put(data, `data:${sessionId}`));
export const loadQueue = async (sessionId: string) =>
  (await run<PendingScan[] | undefined>("readonly", (s) => s.get(`queue:${sessionId}`))) ?? [];
export const saveQueue = (sessionId: string, queue: PendingScan[]) =>
  run("readwrite", (s) => s.put(queue, `queue:${sessionId}`));

/** Lecturas sin subir de todas las funciones (para avisar antes de cerrar sesión). */
export async function pendingCount(): Promise<number> {
  const keys = await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  let total = 0;
  for (const key of keys) {
    if (String(key).startsWith("queue:")) {
      total += (await run<PendingScan[] | undefined>("readonly", (s) => s.get(key)))?.length ?? 0;
    }
  }
  return total;
}

/** Borra todo lo guardado en el equipo (nombres de asistentes incluidos). */
export const clearAll = () => run("readwrite", (s) => s.clear());

/**
 * Decisión sin conexión, con las mismas reglas que el servidor: la entrada tiene que estar
 * en la lista, válida, y ser de una sección de esta puerta (si la puerta tiene secciones).
 */
export function decideOffline(
  data: DoorData,
  tickets: Map<string, DoorTicket>,
  code: string | null,
  gateId: string,
): { result: ScanResult; ticket: DoorTicket | null; allowedGates: string[] } {
  if (!code) return { result: "INVALID", ticket: null, allowedGates: [] };
  const ticket = tickets.get(code) ?? null;
  if (!ticket) return { result: "NOT_FOUND", ticket: null, allowedGates: [] };
  const gate = data.gates.find((g) => g.id === gateId);
  if (gate && gate.sectionIds.length > 0 && !gate.sectionIds.includes(ticket.sectionId ?? "")) {
    const allowedGates = data.gates.filter((g) => g.sectionIds.includes(ticket.sectionId ?? "")).map((g) => g.name);
    return { result: "WRONG_GATE", ticket, allowedGates };
  }
  if (ticket.status === "CANCELLED") return { result: "CANCELLED", ticket, allowedGates: [] };
  if (ticket.status === "USED") return { result: "ALREADY_USED", ticket, allowedGates: [] };
  return { result: "ACCEPTED", ticket, allowedGates: [] };
}
