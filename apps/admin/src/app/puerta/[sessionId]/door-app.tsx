"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { extractTicketCode, formatCode, formatTime } from "@ticketera/core";
import {
  decideOffline,
  loadData,
  loadQueue,
  saveData,
  saveQueue,
  type DoorData,
  type DoorTicket,
  type PendingScan,
  type ScanResult,
} from "../offline-store";
import { CameraScanner } from "./camera-scanner";

const RESULT_VIEW: Record<ScanResult, { title: string; className: string }> = {
  ACCEPTED: { title: "Puede pasar", className: "bg-emerald-600" },
  ALREADY_USED: { title: "Entrada ya utilizada", className: "bg-red-600" },
  NOT_FOUND: { title: "La entrada no existe", className: "bg-red-600" },
  CANCELLED: { title: "Entrada anulada", className: "bg-red-600" },
  WRONG_SESSION: { title: "Es de otra función", className: "bg-amber-500" },
  WRONG_GATE: { title: "Puerta equivocada", className: "bg-amber-500" },
  INVALID: { title: "QR no válido", className: "bg-red-600" },
};

/** Respuesta del servidor a una lectura (ver /api/puerta/scan). */
type ServerOutcome = {
  id: string;
  result: ScanResult;
  ticket: { code: string; holderName: string | null; ticketType: string; event: string; seat: string | null; section: string | null } | null;
  previousEntry: { at: string; accessPoint: string | null } | null;
  allowedGates: string[];
};

type Shown = {
  key: string;
  result: ScanResult;
  code: string | null;
  holder: string | null;
  type: string | null;
  place: string | null;
  detail: string | null;
  offline: boolean;
  at: string;
};

const DEVICE_KEY = "impacta-puerta-equipo";

/** Id aleatorio. randomUUID solo existe con https; getRandomValues funciona también en la red local. */
function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const SYNC_EVERY_MS = 20_000;

function deviceName() {
  try {
    let name = localStorage.getItem(DEVICE_KEY);
    if (!name) {
      name = `Equipo ${newId().slice(0, 4).toUpperCase()}`;
      localStorage.setItem(DEVICE_KEY, name);
    }
    return name;
  } catch {
    return "Equipo sin nombre";
  }
}

/** Pitido y vibración: el operador no necesita mirar la pantalla en cada lectura. */
function feedback(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 80 : [250, 100, 250]);
    const audio = new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.12 : 0.45));
    osc.onended = () => audio.close();
  } catch {
    // sin audio: no es crítico
  }
}

function countStats(tickets: Map<string, DoorTicket>) {
  let issued = 0;
  let used = 0;
  for (const t of tickets.values()) {
    if (t.status !== "CANCELLED") issued++;
    if (t.status === "USED") used++;
  }
  return { issued, used };
}

async function postScans(body: object, timeoutMs: number): Promise<ServerOutcome[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/puerta/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) throw new Error("SESION");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { results: ServerOutcome[] }).results;
  } finally {
    clearTimeout(timer);
  }
}

export function DoorApp({ sessionId, timezone }: { sessionId: string; timezone: string }) {
  const tickets = useRef(new Map<string, DoorTicket>());
  const queue = useRef<PendingScan[]>([]);
  const dataRef = useRef<DoorData | null>(null);
  const busy = useRef(false);
  const lastRead = useRef({ raw: "", at: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<DoorData | null>(null);
  const [stats, setStats] = useState({ issued: 0, used: 0 });
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState(0);
  const [gateId, setGateId] = useState("");
  const [device, setDevice] = useState("");
  const [shown, setShown] = useState<Shown | null>(null);
  const [history, setHistory] = useState<Shown[]>([]);
  const [camera, setCamera] = useState(false);
  const [nfc, setNfc] = useState<"off" | "on" | "unsupported">("off");
  const nfcAbort = useRef<AbortController | null>(null);

  const gateKey = `impacta-puerta-puerta:${sessionId}`;

  /** Aplica una lista descargada, sin perder las entradas que este equipo marcó y aún no subió. */
  const applyData = useCallback(
    async (next: DoorData) => {
      const map = new Map(next.tickets.map((t) => [t.code, t]));
      for (const scan of queue.current) {
        if (scan.offlineResult) continue;
        const code = extractTicketCode(scan.raw);
        const t = code ? map.get(code) : undefined;
        if (t && t.status === "VALID") map.set(t.code, { ...t, status: "USED" });
      }
      tickets.current = map;
      const merged = { ...next, tickets: [...map.values()] };
      dataRef.current = merged;
      setData(merged);
      setStats(countStats(map));
      setLastSync(next.syncedAt);
      await saveData(sessionId, merged);
    },
    [sessionId],
  );

  const persistQueue = useCallback(async () => {
    setPending(queue.current.length);
    await saveQueue(sessionId, queue.current);
  }, [sessionId]);

  /** Sube las lecturas hechas sin conexión y descarga la lista actualizada. */
  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length > 0) {
        const batch = queue.current.slice(0, 200);
        const results = await postScans({ sessionId, deviceId: device || undefined, scans: batch }, 15_000);
        const sent = new Set(batch.map((s) => s.id));
        // Aceptada aquí sin conexión, pero ya había entrado por otro lado: doble ingreso.
        const doubled = results.filter(
          (r) => r.result === "ALREADY_USED" && batch.find((s) => s.id === r.id && !s.offlineResult),
        ).length;
        if (doubled) setConflicts((c) => c + doubled);
        queue.current = queue.current.filter((s) => !sent.has(s.id));
        await persistQueue();
      }
      const res = await fetch(`/api/puerta/${sessionId}/sync`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) throw new Error("SESION");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await applyData((await res.json()) as DoorData);
      setOnline(true);
      setSyncError(null);
    } catch (error) {
      setOnline(false);
      setSyncError(
        error instanceof Error && error.message === "SESION"
          ? "La sesión venció: vuelve a entrar para sincronizar. Puedes seguir validando sin conexión."
          : null,
      );
    } finally {
      busy.current = false;
    }
  }, [sessionId, device, applyData, persistQueue]);

  // Arranque: lo guardado en el equipo primero (abre sin internet), después sincroniza.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const name = deviceName();
      const [saved, savedQueue] = await Promise.all([loadData(sessionId), loadQueue(sessionId)]);
      if (cancelled) return;
      setDevice(name);
      queue.current = savedQueue;
      setPending(savedQueue.length);
      if (saved) await applyData(saved);
      try {
        setGateId(localStorage.getItem(gateKey) ?? "");
      } catch {
        // sin localStorage: puerta sin elegir
      }
      setNfc("NDEFReader" in window ? "off" : "unsupported");
      setOnline(navigator.onLine);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, gateKey, applyData]);

  useEffect(() => {
    if (!device) return;
    const first = setTimeout(sync, 0);
    const timer = setInterval(sync, SYNC_EVERY_MS);
    const goOnline = () => sync();
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      nfcAbort.current?.abort();
    };
  }, [device, sync]);

  useEffect(() => {
    // En computadora (lector USB o teclado) el cursor queda listo en el campo del código.
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, []);

  function show(next: Shown) {
    setShown(next);
    setHistory((h) => [next, ...h].slice(0, 12));
    feedback(next.result === "ACCEPTED");
  }

  function markLocal(code: string | null | undefined, status: DoorTicket["status"]) {
    const t = code ? tickets.current.get(code) : undefined;
    if (!t || t.status === status) return;
    tickets.current.set(t.code, { ...t, status });
    setStats(countStats(tickets.current));
  }

  async function handleRead(raw: string) {
    const value = raw.trim();
    if (!value) return;
    const now = Date.now();
    // La cámara lee el mismo QR varias veces por segundo: una lectura cada 2,5 s.
    if (lastRead.current.raw === value && now - lastRead.current.at < 2500) return;
    lastRead.current = { raw: value, at: now };

    const accessPointId = gateId || undefined;
    const scan = { id: newId(), raw: value, scannedAt: new Date(now).toISOString(), accessPointId };

    if (navigator.onLine) {
      try {
        const [outcome] = await postScans(
          { sessionId, deviceId: device || undefined, scans: [{ ...scan, offline: false }] },
          4000,
        );
        if (outcome) {
          if (outcome.result === "ACCEPTED") markLocal(outcome.ticket?.code, "USED");
          if (outcome.result === "CANCELLED") markLocal(outcome.ticket?.code, "CANCELLED");
          setOnline(true);
          show({
            key: scan.id,
            result: outcome.result,
            code: outcome.ticket?.code ?? null,
            holder: outcome.ticket?.holderName ?? null,
            type: outcome.ticket?.ticketType ?? null,
            place: [outcome.ticket?.section, outcome.ticket?.seat].filter(Boolean).join(" · ") || null,
            detail:
              outcome.result === "ALREADY_USED" && outcome.previousEntry
                ? `Entró a las ${formatTime(new Date(outcome.previousEntry.at), timezone)}${outcome.previousEntry.accessPoint ? ` por ${outcome.previousEntry.accessPoint}` : ""}`
                : outcome.result === "WRONG_GATE"
                  ? outcome.allowedGates.length
                    ? `Debe entrar por: ${outcome.allowedGates.join(", ")}`
                    : "Su sección no tiene puerta asignada."
                  : outcome.result === "WRONG_SESSION" && outcome.ticket
                    ? `Es para: ${outcome.ticket.event}`
                    : null,
            offline: false,
            at: scan.scannedAt,
          });
          return;
        }
      } catch {
        // Sin respuesta: se decide con la lista del equipo. Se reutiliza el mismo id, así que
        // si el servidor sí la había registrado, al sincronizar no cuenta doble.
        setOnline(false);
      }
    }

    const current = dataRef.current;
    if (!current) {
      show({ key: scan.id, result: "INVALID", code: null, holder: null, type: null, place: null, detail: "Sin internet y sin lista descargada: conéctate una vez para descargarla.", offline: true, at: scan.scannedAt });
      return;
    }
    const code = extractTicketCode(value);
    const decision = decideOffline(current, tickets.current, code, gateId);
    if (decision.result === "ACCEPTED") markLocal(code, "USED");
    queue.current.push({
      ...scan,
      offline: true,
      ...(decision.result === "ACCEPTED" ? {} : { offlineResult: decision.result }),
    });
    await persistQueue();
    const t = decision.ticket;
    show({
      key: scan.id,
      result: decision.result,
      code: t?.code ?? null,
      holder: t?.holder ?? null,
      type: t?.type ?? null,
      place: [t?.sectionId ? current.sections[t.sectionId] : null, t?.seat].filter(Boolean).join(" · ") || null,
      detail:
        decision.result === "NOT_FOUND" && code
          ? `No está en la lista descargada${lastSync ? ` (${formatTime(new Date(lastSync), timezone)})` : ""}. Si la compró recién, valídala cuando vuelva internet.`
          : decision.result === "WRONG_GATE"
            ? decision.allowedGates.length
              ? `Debe entrar por: ${decision.allowedGates.join(", ")}`
              : "Su sección no tiene puerta asignada."
            : null,
      offline: true,
      at: scan.scannedAt,
    });
  }

  // El lector NFC queda escuchando: siempre tiene que usar la versión actual (puerta elegida, etc.).
  const handleReadRef = useRef(handleRead);
  useEffect(() => {
    handleReadRef.current = handleRead;
  });

  function onManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = inputRef.current;
    if (!input) return;
    const value = input.value;
    input.value = "";
    lastRead.current = { raw: "", at: 0 }; // a mano siempre se valida, aunque se repita
    handleRead(value);
  }

  async function toggleNfc() {
    if (nfc === "on") {
      nfcAbort.current?.abort();
      setNfc("off");
      return;
    }
    type NdefRecord = { recordType: string; encoding?: string; data?: DataView };
    type NdefReader = {
      scan(options: { signal: AbortSignal }): Promise<void>;
      onreading: ((event: { message: { records: NdefRecord[] } }) => void) | null;
    };
    const Reader = (window as unknown as { NDEFReader?: new () => NdefReader }).NDEFReader;
    if (!Reader) return;
    try {
      const controller = new AbortController();
      const reader = new Reader();
      await reader.scan({ signal: controller.signal });
      reader.onreading = (event) => {
        for (const record of event.message.records) {
          if ((record.recordType === "text" || record.recordType === "url") && record.data) {
            handleReadRef.current(new TextDecoder(record.encoding || "utf-8").decode(record.data));
            return;
          }
        }
      };
      nfcAbort.current = controller;
      setNfc("on");
    } catch {
      setNfc("off");
      window.alert("No se pudo activar NFC. Revisa que esté encendido en el celular y da el permiso.");
    }
  }

  function chooseGate(id: string) {
    setGateId(id);
    try {
      localStorage.setItem(gateKey, id);
    } catch {
      // sin localStorage: vale solo mientras esté abierta la página
    }
  }

  function renameDevice() {
    const name = window.prompt("Nombre de este equipo (aparece en los reportes):", device)?.trim();
    if (!name) return;
    const clean = name.slice(0, 60);
    try {
      localStorage.setItem(DEVICE_KEY, clean);
    } catch {
      // sin localStorage
    }
    setDevice(clean);
  }

  const view = shown ? RESULT_VIEW[shown.result] : null;
  const gate = data?.gates.find((g) => g.id === gateId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-medium ${online ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
          {online ? "En línea" : "Sin conexión"}
        </span>
        <span className="text-white/60">
          {lastSync ? `Lista al ${formatTime(new Date(lastSync), timezone)}` : "Descargando lista…"}
        </span>
        {pending > 0 && (
          <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-amber-300">{pending} lectura(s) sin subir</span>
        )}
        {conflicts > 0 && (
          <span className="rounded-full bg-red-500/20 px-2.5 py-1 text-red-300">
            {conflicts} doble(s) ingreso(s) detectado(s) al sincronizar
          </span>
        )}
        <button type="button" onClick={renameDevice} className="ml-auto text-white/60 underline">
          {device || "…"}
        </button>
      </div>
      {syncError && <p className="rounded-lg bg-amber-500/15 p-3 text-sm text-amber-200">{syncError}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white/5 p-4">
          <p className="text-xs uppercase tracking-wide text-white/50">Ingresaron</p>
          <p className="font-mono text-3xl">
            {stats.used}
            <span className="text-lg text-white/40"> / {stats.issued}</span>
          </p>
        </div>
        <label className="rounded-xl bg-white/5 p-4 text-xs uppercase tracking-wide text-white/50">
          Puerta
          <select
            value={gateId}
            onChange={(e) => chooseGate(e.target.value)}
            className="mt-1 block w-full rounded-md bg-white/10 px-2 py-2 text-base normal-case tracking-normal text-white"
          >
            <option value="" className="text-black">
              Sin puerta (acepta todas)
            </option>
            {data?.gates.map((g) => (
              <option key={g.id} value={g.id} className="text-black">
                {g.name}
                {g.sections.length ? ` — ${g.sections.join(", ")}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {gate && gate.sections.length > 0 && (
        <p className="text-xs text-white/50">Esta puerta solo acepta: {gate.sections.join(", ")}.</p>
      )}

      {shown && view && (
        <div key={shown.key} role="status" className={`rounded-2xl p-6 text-white ${view.className}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-3xl font-bold leading-tight">{view.title}</p>
            {shown.offline && <span className="rounded bg-black/25 px-2 py-0.5 text-xs">sin conexión</span>}
          </div>
          {(shown.holder || shown.type) && (
            <p className="mt-2 text-lg">
              {shown.holder ?? "Sin nombre"}
              {shown.type && <span className="opacity-80"> · {shown.type}</span>}
            </p>
          )}
          {shown.place && <p className="text-lg font-semibold">{shown.place}</p>}
          {shown.detail && <p className="mt-1 opacity-90">{shown.detail}</p>}
          {shown.code && <p className="mt-2 font-mono text-sm opacity-80">{formatCode(shown.code)}</p>}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setCamera((c) => !c)}
          className={`flex-1 rounded-xl px-4 py-4 text-lg font-semibold ${camera ? "bg-white text-black" : "bg-emerald-600 text-white"}`}
        >
          {camera ? "Cerrar cámara" : "Escanear con cámara"}
        </button>
        {nfc !== "unsupported" && (
          <button
            type="button"
            onClick={toggleNfc}
            className={`rounded-xl px-4 py-4 text-lg font-semibold ${nfc === "on" ? "bg-white text-black" : "bg-white/10 text-white"}`}
          >
            {nfc === "on" ? "NFC activo" : "NFC"}
          </button>
        )}
      </div>
      {camera && <CameraScanner onRead={handleRead} />}

      <form onSubmit={onManual} className="flex gap-2">
        <input
          ref={inputRef}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="Código o lector USB (ej. K7Q3M-XPA2B)"
          className="min-w-0 flex-1 rounded-xl bg-white/10 px-4 py-3 font-mono text-white placeholder:text-white/40"
        />
        <button type="submit" className="rounded-xl bg-white/15 px-5 py-3 font-semibold">
          Validar
        </button>
      </form>

      {history.length > 1 && (
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-white/50">Últimas lecturas</h2>
          <ul className="divide-y divide-white/10 rounded-xl bg-white/5 text-sm">
            {history.slice(1).map((h) => (
              <li key={h.key} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="truncate">
                  <span className="font-mono text-xs text-white/50">{formatTime(new Date(h.at), timezone)}</span>{" "}
                  {h.holder ?? (h.code ? formatCode(h.code) : "—")}
                </span>
                <span className={h.result === "ACCEPTED" ? "text-emerald-300" : "text-red-300"}>
                  {RESULT_VIEW[h.result].title}
                  {h.offline ? " ·" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
