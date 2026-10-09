/**
 * Llaves de las entradas de QR dinámico guardadas en el celular (IndexedDB), para generar el QR sin internet.
 * Cada registro es de una cuenta: al cambiar de cuenta o cerrar sesión se borran.
 */
export type StoredKey = {
  code: string;
  userId: string;
  /** Llave (base64url) con la que se calcula la prueba. */
  key: string;
  /** Hora del servidor menos hora del celular, medida al pedir la llave. */
  offsetMs: number;
  validUntil: string;
  status: "VALID" | "USED";
  savedAt: number;
};

const DB = "impacta-entradas";
const STORE = "keys";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "code" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const saveKey = (record: StoredKey) => run("readwrite", (s) => s.put(record)).then(() => undefined);

export async function loadKey(code: string, userId: string): Promise<StoredKey | null> {
  const record = (await run("readonly", (s) => s.get(code))) as StoredKey | undefined;
  if (!record || record.userId !== userId || new Date(record.validUntil) < new Date()) return null;
  return record;
}

/** Borra todo lo guardado (al cerrar sesión). */
export const purgeAllKeys = () => run("readwrite", (s) => s.clear()).then(() => undefined);

/** Borra lo de otras cuentas y lo vencido (se llama al abrir Mis entradas). */
export async function purgeStaleKeys(userId: string) {
  const all = (await run("readonly", (s) => s.getAll())) as StoredKey[];
  const now = new Date();
  await Promise.all(
    all.filter((r) => r.userId !== userId || new Date(r.validUntil) < now).map((r) => run("readwrite", (s) => s.delete(r.code))),
  );
}

export async function hasKey(code: string, userId: string) {
  return (await loadKey(code, userId)) !== null;
}

/** Pide la llave al servidor y la guarda. Devuelve el registro, o el motivo si no se pudo. */
export async function syncKey(code: string, userId: string): Promise<{ ok: true; record: StoredKey } | { ok: false; status: number | "offline"; message: string }> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`/api/entradas/${encodeURIComponent(code)}/llave`, { cache: "no-store", credentials: "same-origin" });
  } catch {
    return { ok: false, status: "offline", message: "Sin conexión." };
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    key?: string;
    serverTime?: string;
    validUntil?: string;
    status?: "VALID" | "USED";
  };
  if (!response.ok || !body.key || !body.serverTime || !body.validUntil || !body.status) {
    return { ok: false, status: response.status, message: body.error ?? "No se pudo abrir la entrada." };
  }
  // El servidor armó la respuesta hacia la mitad del viaje: el desfase se mide contra ese instante.
  const midpoint = (started + Date.now()) / 2;
  const record: StoredKey = {
    code,
    userId,
    key: body.key,
    offsetMs: new Date(body.serverTime).getTime() - midpoint,
    validUntil: body.validUntil,
    status: body.status,
    savedAt: Date.now(),
  };
  await saveKey(record);
  return { ok: true, record };
}
