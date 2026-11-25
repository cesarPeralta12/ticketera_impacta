"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { parseReaderUid } from "@ticketera/core";
import { focusForReader, formatUid, useBrowserHas, useReaderOrder, type WebNfcWindow } from "@/components/nfc-reading";
import { ReaderSettings } from "@/components/reader-settings";
import { addWristbandReadAction, confirmWristbandBatchAction, discardWristbandBatchAction, removeWristbandReadAction } from "@/lib/actions/wristbands";

type Row = { id: string; uid: string };
type Read = { uid: string; source: "PHONE" | "USB" };
type Notice = { kind: "ok" | "repeated" | "error"; text: string };

/** Una manilla apoyada sobre el lector se lee varias veces seguidas: dentro de este margen cuenta una. */
const SAME_CARD_MS = 2500;
/** Cuántas filas se muestran sin buscar (un lote puede tener miles). */
const SHOWN = 50;

const NOTICE_STYLE = {
  ok: "bg-[var(--success-soft)] text-[var(--success)]",
  repeated: "bg-[var(--warn-soft)] text-[var(--warn)]",
  error: "bg-[var(--danger-soft)] text-[var(--danger)]",
};

/** Un tono por resultado, para cargar sin mirar la pantalla: agudo bien, dos medios repetida, grave error. */
function useBeep() {
  const audio = useRef<AudioContext | null>(null);
  return useCallback((kind: Notice["kind"]) => {
    navigator.vibrate?.(kind === "ok" ? 60 : kind === "repeated" ? [60, 60, 60] : 350);
    try {
      const context = (audio.current ??= new AudioContext());
      void context.resume();
      const tones = kind === "ok" ? [[880, 0]] : kind === "repeated" ? [[520, 0], [520, 0.16]] : [[220, 0]];
      for (const [frequency, delay] of tones) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency!;
        gain.gain.value = 0.15;
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(context.currentTime + delay!);
        oscillator.stop(context.currentTime + delay! + (kind === "error" ? 0.4 : 0.1));
      }
    } catch {
      // Sin audio en este navegador: quedan el color y la vibración.
    }
  }, []);
}

export function BatchReader({
  batchId,
  backHref,
  initial,
  expected,
  available,
  manage,
}: {
  batchId: string;
  backHref: string;
  initial: Row[];
  expected: number | null;
  available: number;
  manage: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [unsent, setUnsent] = useState<Read[]>([]);
  const [usb, setUsb] = useState("");
  const [search, setSearch] = useState("");
  const [phoneReading, setPhoneReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasNfc = useBrowserHas("NDEFReader");
  const [order, changeOrder] = useReaderOrder();
  const beep = useBeep();
  const usbRef = useRef<HTMLInputElement>(null);
  const queue = useRef<Read[]>([]);
  const sending = useRef(false);
  const last = useRef({ uid: "", at: 0 });
  const nfcAbort = useRef<AbortController | null>(null);

  const say = useCallback(
    (next: Notice) => {
      setNotice(next);
      beep(next.kind);
    },
    [beep],
  );

  /** Envía las lecturas de a una y en orden: así el número de cada manilla es el orden en que se acercó. */
  const drain = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    while (queue.current.length > 0) {
      const read = queue.current[0]!;
      try {
        const result = await addWristbandReadAction({ batchId, ...read });
        if (result.ok) {
          setRows((current) => [...current, { id: result.id, uid: result.uid }]);
          say({ kind: "ok", text: `N.º ${result.count} · ${formatUid(result.uid)}` });
        } else {
          say({ kind: result.repeated ? "repeated" : "error", text: `${formatUid(read.uid)}: ${result.error}` });
        }
        queue.current.shift();
      } catch {
        // Sin conexión: todo lo pendiente se guarda, en orden, para reenviarlo.
        const pending = queue.current.splice(0);
        setUnsent((current) => [...current, ...pending]);
        say({ kind: "error", text: "Sin conexión: las lecturas quedaron sin enviar. Revisa internet y reenvíalas." });
      }
      setWaiting(queue.current.length);
    }
    sending.current = false;
  }, [batchId, say]);

  const enqueue = useCallback(
    (uid: string, source: Read["source"]) => {
      const now = Date.now();
      const same = last.current.uid === uid && now - last.current.at < SAME_CARD_MS;
      last.current = { uid, at: now };
      if (same) return;
      queue.current.push({ uid, source });
      setWaiting(queue.current.length);
      void drain();
    },
    [drain],
  );

  useEffect(() => focusForReader(usbRef.current), []);
  useEffect(() => () => nfcAbort.current?.abort(), []);
  // Cerrar la página con lecturas sin enviar las perdería.
  const dirty = waiting > 0 || unsent.length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function stopPhone() {
    nfcAbort.current?.abort();
    nfcAbort.current = null;
    setPhoneReading(false);
  }

  async function readWithPhone() {
    const Reader = (window as WebNfcWindow).NDEFReader;
    if (!Reader) return;
    stopPhone();
    const abort = new AbortController();
    nfcAbort.current = abort;
    try {
      const reader = new Reader();
      reader.onreading = (event) => {
        if (abort.signal.aborted) return;
        const uid = parseReaderUid(event.serialNumber ?? "");
        if (uid) enqueue(uid, "PHONE");
        else say({ kind: "error", text: "Esa tarjeta no entregó un número de serie válido." });
      };
      reader.onreadingerror = () => say({ kind: "error", text: "No se pudo leer esa tarjeta. Acércala de nuevo." });
      await reader.scan({ signal: abort.signal });
      beep("ok");
      setPhoneReading(true);
    } catch {
      setPhoneReading(false);
      say({ kind: "error", text: "No se pudo activar el NFC. Revisa que esté encendido y permite el acceso cuando el navegador lo pida." });
    }
  }

  function submitUsb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const uid = parseReaderUid(usb, order);
    setUsb("");
    if (uid) enqueue(uid, "USB");
    else if (usb.trim()) say({ kind: "error", text: "Lo que envió el lector no es un número de serie válido. El lector debe estar en hexadecimal." });
  }

  function resend() {
    queue.current.push(...unsent);
    setUnsent([]);
    setWaiting(queue.current.length);
    void drain();
  }

  async function remove(row: Row, number: number) {
    if (!window.confirm(`¿Quitar la manilla n.º ${number} del lote? Las siguientes bajan un número.`)) return;
    setBusy(true);
    try {
      const result = await removeWristbandReadAction(batchId, row.id);
      if (result.ok) {
        setRows((current) => current.filter((r) => r.id !== row.id));
        last.current = { uid: "", at: 0 };
        setNotice(null);
      } else say({ kind: "error", text: result.error });
    } catch {
      say({ kind: "error", text: "Sin conexión: no se pudo quitar." });
    } finally {
      setBusy(false);
      focusForReader(usbRef.current);
    }
  }

  async function close(action: "confirm" | "discard") {
    const question =
      action === "confirm"
        ? `¿Confirmar ${rows.length} manillas? Se creará una entrada por cada una.`
        : `¿Descartar el lote? Se borran las ${rows.length} lecturas y las manillas quedan libres.`;
    if (!window.confirm(question)) return;
    stopPhone();
    setBusy(true);
    try {
      const result = action === "confirm" ? await confirmWristbandBatchAction(batchId) : await discardWristbandBatchAction(batchId);
      if (!result.ok) say({ kind: "error", text: result.error });
      else if (action === "discard") router.push(backHref);
      else router.refresh();
    } catch {
      say({ kind: "error", text: "Sin conexión. Recarga la página para ver si el lote quedó confirmado." });
    } finally {
      setBusy(false);
    }
  }

  const wanted = search.replace(/[\s:#-]/g, "").toUpperCase();
  const numbered = rows.map((row, i) => ({ row, number: i + 1 }));
  const found = wanted ? numbered.filter(({ row, number }) => row.uid.includes(wanted) || String(number) === wanted) : numbered;
  const visible = found.toReversed().slice(0, SHOWN);

  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p>
            <span className="font-mono text-5xl font-semibold">{rows.length}</span>
            <span className="ml-2 text-[var(--ink-muted)]">{expected ? `de ${expected} manillas` : "manillas leídas"}</span>
          </p>
          <p className="text-sm text-[var(--ink-muted)]">
            Lugares libres del tipo: {available}
            {waiting > 0 ? ` · enviando ${waiting}…` : ""}
          </p>
        </div>
        {expected !== null && (
          <progress className="h-2 w-full accent-[var(--accent)]" max={expected} value={Math.min(rows.length, expected)} aria-label="Avance del lote" />
        )}

        {/* El último resultado, grande: es lo que se mira al cargar. */}
        <p
          role="status"
          aria-live="assertive"
          className={`min-h-14 rounded-md px-4 py-3 text-base font-medium ${notice ? NOTICE_STYLE[notice.kind] : "bg-[var(--surface-2)] text-[var(--ink-muted)]"}`}
        >
          {notice?.text ?? "Acerca una manilla tras otra."}
        </p>

        {unsent.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
            <span>{unsent.length} lectura(s) sin enviar.</span>
            <button type="button" className="btn" onClick={resend}>
              Reenviar
            </button>
          </div>
        )}

        {hasNfc && (
          <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={phoneReading ? stopPhone : readWithPhone}>
            {phoneReading ? "Leyendo… (tocar para pausar)" : "Leer con el NFC del teléfono"}
          </button>
        )}
        <form onSubmit={submitUsb} className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <label className="label grow">
              Lector USB de tarjetas
              <input
                ref={usbRef}
                value={usb}
                onChange={(e) => setUsb(e.target.value)}
                disabled={busy}
                autoComplete="off"
                autoCapitalize="characters"
                placeholder="Deja el cursor aquí y acerca las manillas al lector"
                className="field font-mono"
              />
            </label>
            <button type="submit" disabled={busy || !usb.trim()} className="btn">
              Agregar
            </button>
          </div>
          <ReaderSettings order={order} onChange={changeOrder} />
        </form>
      </section>

      <section className="card space-y-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="eyebrow">Manillas del lote</h2>
          <label className="label">
            Buscar por número o serie
            <input value={search} onChange={(e) => setSearch(e.target.value)} className="field font-mono" />
          </label>
        </div>
        {visible.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">{wanted ? "No hay ninguna con eso." : "Todavía no se leyó ninguna."}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {visible.map(({ row, number }) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="mr-3 inline-block min-w-10 font-semibold">{number}</span>
                  <span className="font-mono text-xs">{formatUid(row.uid)}</span>
                </span>
                <button type="button" disabled={busy || dirty} onClick={() => remove(row, number)} className="text-xs text-[var(--danger)] hover:underline disabled:opacity-50">
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
        {found.length > visible.length && (
          <p className="text-xs text-[var(--ink-dim)]">
            Se muestran las {visible.length} más recientes de {found.length}. Usa el buscador para ver otra.
          </p>
        )}
      </section>

      {manage ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" disabled={busy || dirty || rows.length === 0} onClick={() => close("confirm")}>
            {busy ? "Un momento…" : `Confirmar ${rows.length} manillas`}
          </button>
          <button type="button" className="btn" disabled={busy || dirty} onClick={() => close("discard")}>
            Descartar el lote
          </button>
        </div>
      ) : (
        <p className="text-sm text-[var(--ink-muted)]">Cuando termines, avisa a un administrador para que confirme el lote.</p>
      )}
    </div>
  );
}
