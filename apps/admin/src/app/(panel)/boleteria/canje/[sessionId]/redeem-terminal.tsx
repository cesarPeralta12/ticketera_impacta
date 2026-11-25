"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { formatCode, parseReaderUid } from "@ticketera/core";
import type { RedeemTicket } from "@ticketera/db";
import { focusForReader, formatUid, useBrowserHas, useReaderOrder, type WebNfcWindow } from "@/components/nfc-reading";
import { ReaderSettings } from "@/components/reader-settings";
import { linkRedeemAction, lookupRedeemAction } from "@/lib/actions/redeem";
import { CameraReader } from "./camera-reader";

/** Vibración corta al leer bien y doble al fallar, para no tener que mirar la pantalla (donde el aparato vibra). */
function signal(ok: boolean) {
  navigator.vibrate?.(ok ? 80 : [120, 80, 120]);
}

export function RedeemTerminal({ sessionId }: { sessionId: string }) {
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [ticket, setTicket] = useState<RedeemTicket | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [done, setDone] = useState<{ uid: string; replaced: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phoneReading, setPhoneReading] = useState(false);
  const [usb, setUsb] = useState("");
  const [count, setCount] = useState(0);
  const [pending, startTransition] = useTransition();
  const hasNfc = useBrowserHas("NDEFReader");
  const hasCamera = useBrowserHas("BarcodeDetector");
  const [order, changeOrder] = useReaderOrder();
  const codeRef = useRef<HTMLInputElement>(null);
  const usbRef = useRef<HTMLInputElement>(null);
  const nfcAbort = useRef<AbortController | null>(null);
  const linking = useRef(false);

  /** Lista para acercar la tarjeta: hay entrada, no terminó y, si ya tenía una, se confirmó el cambio. */
  const waitingCard = ticket !== null && done === null && (ticket.currentUid === null || replacing);

  const stopNfc = useCallback(() => {
    nfcAbort.current?.abort();
    nfcAbort.current = null;
    setPhoneReading(false);
  }, []);

  useEffect(() => () => nfcAbort.current?.abort(), []);
  useEffect(() => {
    if (waitingCard) focusForReader(usbRef.current);
  }, [waitingCard]);
  // Al empezar y al terminar, el cursor queda en la lectura: el lector de la siguiente entrada escribe ahí.
  const askingEntry = ticket === null || done !== null;
  useEffect(() => {
    if (askingEntry && !camera && !pending) focusForReader(codeRef.current);
  }, [askingEntry, camera, pending]);

  const lookup = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      setError(null);
      setCamera(false);
      setUsb("");
      stopNfc();
      startTransition(async () => {
        const result = await lookupRedeemAction(sessionId, value);
        setCode("");
        if (result.ok) {
          setTicket(result.ticket);
          setReplacing(false);
          setDone(null);
          signal(true);
        } else {
          setTicket(null);
          setDone(null);
          setError(result.error);
          signal(false);
        }
      });
    },
    [sessionId, stopNfc],
  );

  function link(uid: string, source: "PHONE" | "USB", current: RedeemTicket) {
    // Una tarjeta apoyada se lee varias veces seguidas: solo se envía una.
    if (linking.current) return;
    linking.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await linkRedeemAction({ sessionId, code: current.code, uid, source, replace: current.currentUid !== null });
        setUsb("");
        if (result.ok) {
          stopNfc();
          setDone(result);
          setCount((n) => n + 1);
          signal(true);
        } else {
          setError(result.error);
          signal(false);
        }
      } finally {
        linking.current = false;
      }
    });
  }

  async function readWithPhone(current: RedeemTicket) {
    const Reader = (window as WebNfcWindow).NDEFReader;
    if (!Reader) return;
    setError(null);
    stopNfc();
    const abort = new AbortController();
    nfcAbort.current = abort;
    try {
      const reader = new Reader();
      reader.onreading = (event) => {
        if (abort.signal.aborted) return;
        if (!event.serialNumber) {
          setError("La tarjeta no entregó su número de serie. Prueba con otra.");
          return;
        }
        link(event.serialNumber, "PHONE", current);
      };
      reader.onreadingerror = () => setError("No se pudo leer esa tarjeta con el navegador. Acércala de nuevo o prueba con la app iPass Canje.");
      await reader.scan({ signal: abort.signal });
      setPhoneReading(true);
    } catch {
      setPhoneReading(false);
      setError("No se pudo activar el NFC. Revisa que esté encendido y permite el acceso cuando el navegador lo pida.");
    }
  }

  function submitUsb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticket || !usb.trim()) return;
    const uid = parseReaderUid(usb, order);
    if (!uid) {
      setUsb("");
      setError("Lo que envió el lector no es un número de serie válido. El lector debe estar en formato hexadecimal.");
      signal(false);
      return;
    }
    link(uid, "USB", ticket);
  }

  function next() {
    setCamera(false);
    stopNfc();
    setTicket(null);
    setDone(null);
    setError(null);
    setReplacing(false);
    setUsb("");
  }

  const preview = usb.trim() ? parseReaderUid(usb, order) : null;

  const entryReader = (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup(code);
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="label grow">
          {done ? "Siguiente entrada: léela o escribe su código" : "QR, código de barras o código escrito"}
          <input
            ref={codeRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="Lector USB o código (ej. K7Q3M-XPA2B)"
            className="field font-mono"
          />
        </label>
        <button type="submit" disabled={pending || !code.trim()} className="btn btn-primary">
          {pending ? "Buscando…" : "Buscar entrada"}
        </button>
      </form>
      {hasCamera &&
        (camera ? (
          <CameraReader onRead={lookup} onClose={() => setCamera(false)} />
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setError(null);
              setCamera(true);
            }}
          >
            Leer con la cámara
          </button>
        ))}
    </div>
  );

  return (
    <section className="card space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow">{ticket ? "2. Acerca la tarjeta" : "1. Lee la entrada del cliente"}</h2>
        {count > 0 && <span className="badge bg-[var(--success-soft)] text-[var(--success)]">{count} canjeada(s) en esta sesión</span>}
      </div>

      {!ticket && entryReader}

      {error && (
        <p role="alert" className="rounded-md bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger)]">
          {error}
        </p>
      )}

      {ticket && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] p-4">
            <p className="text-lg font-semibold">{ticket.holder ?? "Sin nombre"}</p>
            <p className="text-sm text-[var(--ink-muted)]">
              {ticket.type}
              {ticket.seat ? ` · ${ticket.seat}` : ""}
              {ticket.document ? ` · Carnet ${ticket.document}` : ""}
            </p>
            <p className="font-mono text-xs text-[var(--ink-dim)]">Código {formatCode(ticket.code)}</p>
          </div>

          {ticket.notice && <p className="rounded-md bg-[var(--warn-soft)] px-4 py-3 text-sm text-[var(--warn)]">{ticket.notice}</p>}

          {done ? (
            <p role="status" className="rounded-md bg-[var(--success-soft)] px-4 py-3 text-sm font-medium text-[var(--success)]">
              {done.replaced ? "Tarjeta cambiada: la anterior ya no abre la puerta." : "Tarjeta vinculada. Entrégasela al cliente."}
              <span className="mt-1 block font-mono text-xs">Número de serie {formatUid(done.uid)}</span>
            </p>
          ) : !waitingCard ? (
            <div className="space-y-3 rounded-md bg-[var(--warn-soft)] px-4 py-3 text-sm text-[var(--warn)]">
              <p>
                Esta entrada <strong>ya tiene una tarjeta</strong> ({formatUid(ticket.currentUid!)}). Cámbiala solo si se perdió o se dañó, y
                verifica el carnet del cliente: la anterior dejará de abrir la puerta.
              </p>
              <button type="button" className="btn" onClick={() => setReplacing(true)}>
                Cambiar la tarjeta
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {hasNfc && (
                <div className="space-y-2">
                  <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={pending} onClick={() => readWithPhone(ticket)}>
                    {phoneReading ? "Esperando la tarjeta…" : "Leer con el NFC del teléfono"}
                  </button>
                  {phoneReading && <p className="text-sm text-[var(--ink-muted)]">Apoya la tarjeta o manilla en la parte de atrás del teléfono.</p>}
                </div>
              )}
              <form onSubmit={submitUsb} className="space-y-2">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="label grow">
                    Lector USB de tarjetas
                    <input
                      ref={usbRef}
                      value={usb}
                      onChange={(e) => setUsb(e.target.value)}
                      autoComplete="off"
                      autoCapitalize="characters"
                      placeholder="Acerca la tarjeta al lector"
                      className="field font-mono"
                    />
                  </label>
                  <button type="submit" disabled={pending || !usb.trim()} className="btn">
                    {pending ? "Vinculando…" : "Vincular"}
                  </button>
                </div>
                {preview && <p className="font-mono text-xs text-[var(--ink-dim)]">Se guardará {formatUid(preview)}</p>}
                <ReaderSettings order={order} onChange={changeOrder} />
              </form>
            </div>
          )}

          {done ? (
            entryReader
          ) : (
            <button type="button" className="btn" onClick={next} disabled={pending}>
              Otra entrada
            </button>
          )}
        </div>
      )}
    </section>
  );
}
