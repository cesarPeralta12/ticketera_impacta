"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { STEP_SECONDS, dynamicOtp, formatCode, fromBase64Url, signDynamicPayload, stepAt } from "@ticketera/core";
import { loadKey, purgeAllKeys, purgeStaleKeys, syncKey, type StoredKey } from "../offline-store";

type Props = {
  code: string;
  userId: string;
  eventTitle: string;
  when: string;
  venue: string;
  typeName: string;
  seat: string | null;
  holder: string | null;
  initialStatus: "VALID" | "USED";
};

type Shown = { step: number; svg: string; otp: string };

/** Cada cuánto se vuelve a pedir la llave si hay internet (para enterarse de que la entrada ya se usó o se transfirió). */
const RESYNC_MS = 2 * 60_000;

/**
 * La entrada de QR dinámico: el QR se calcula AQUÍ, en el celular, con una llave guardada, y cambia cada
 * 30 segundos. No hace falta internet para mostrarlo: basta con haber abierto la entrada una vez con conexión.
 * Una captura de pantalla deja de valer en menos de un minuto y medio.
 */
export function DynamicTicket(props: Props) {
  const { code, userId } = props;
  const [record, setRecord] = useState<StoredKey | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<{ message: string; login?: boolean } | null>(null);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState<number | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const lastSync = useRef(0);
  const generating = useRef(false);

  const sync = useCallback(async () => {
    lastSync.current = Date.now();
    const result = await syncKey(code, userId);
    if (result.ok) {
      setRecord(result.record);
      setProblem(null);
      setOnline(true);
      return;
    }
    if (result.status === "offline") {
      setOnline(false);
      return;
    }
    setOnline(true);
    if (result.status === 401) {
      await purgeAllKeys().catch(() => {});
      setRecord(null);
      setProblem({ message: "Tu sesión terminó. Inicia sesión para abrir tu entrada.", login: true });
    } else {
      setProblem({ message: result.message });
    }
  }, [code, userId]);

  // Al abrir: lo guardado en el celular primero (funciona sin internet) y, si hay conexión, se actualiza.
  useEffect(() => {
    let cancelled = false;
    if (typeof crypto === "undefined" || !crypto.subtle) {
      queueMicrotask(() => setProblem({ message: "Esta página necesita una conexión segura (https) para mostrar el QR." }));
      return;
    }
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    (async () => {
      await purgeStaleKeys(userId).catch(() => {});
      const stored = await loadKey(code, userId).catch(() => null);
      if (cancelled) return;
      if (stored) setRecord(stored);
      setLoaded(true);
      if (navigator.onLine) await sync();
      else setOnline(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [code, userId, sync]);

  // Al recuperar la conexión o volver a la pantalla, se actualiza (con un respiro entre pedidos).
  useEffect(() => {
    // "Hay internet" solo se da por cierto cuando una sincronización sale bien (el navegador puede creer que
    // hay red y no llegar al servidor).
    const refresh = () => {
      if (!navigator.onLine) setOnline(false);
      else if (Date.now() - lastSync.current > RESYNC_MS) void sync();
    };
    const offline = () => setOnline(false);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sync]);

  // Reloj: la hora del servidor según este celular (su reloj más el desfase medido al pedir la llave).
  useEffect(() => {
    if (!record) return;
    const offset = record.offsetMs;
    const tick = () => setNow(Date.now() + offset);
    const id = setInterval(tick, 250);
    tick();
    return () => clearInterval(id);
  }, [record]);

  // QR nuevo al cambiar de paso.
  useEffect(() => {
    if (!record || now === null || generating.current) return;
    const step = stepAt(now);
    if (shown?.step === step) return;
    generating.current = true;
    (async () => {
      const key = fromBase64Url(record.key);
      const payload = await signDynamicPayload(key, code, step * STEP_SECONDS * 1000);
      const [svg, otp] = await Promise.all([
        QRCode.toString(payload, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
        dynamicOtp(key, code, step),
      ]);
      setShown({ step, svg, otp });
    })()
      .catch(() => setProblem({ message: "No se pudo generar el QR en este celular." }))
      .finally(() => {
        generating.current = false;
      });
  }, [record, now, shown, code]);

  const secondsLeft = now === null ? STEP_SECONDS : STEP_SECONDS - ((now / 1000) % STEP_SECONDS);
  const used = (record?.status ?? props.initialStatus) === "USED";
  const otp = shown ? `${shown.otp.slice(0, 3)} ${shown.otp.slice(3)}` : "";

  return (
    <div className="mx-auto w-full max-w-sm space-y-4">
      <div className="rounded-3xl bg-[#f5f3ef] p-6 text-center text-[#14181b]">
        <p className="text-xs uppercase tracking-wide text-[#6b687a]">Entrada · QR dinámico</p>
        <p className="font-display text-2xl">{props.eventTitle}</p>
        <p className="text-xs text-[#6b687a]">
          {props.when} · {props.venue}
        </p>
        <p className="mt-1 font-semibold">
          {props.typeName}
          {props.seat ? ` · ${props.seat}` : ""}
        </p>
        {props.holder && <p className="text-sm text-[#6b687a]">{props.holder}</p>}

        {problem ? (
          <div role="alert" className="mt-4 rounded-xl bg-[#fde8e8] p-4 text-sm text-[#9b1c1c]">
            <p>{problem.message}</p>
            {problem.login && (
              <Link href={`/login?next=${encodeURIComponent(`/entrada/${code}`)}`} className="mt-2 inline-block font-semibold underline">
                Iniciar sesión
              </Link>
            )}
          </div>
        ) : !loaded ? (
          <p className="my-12 text-sm text-[#6b687a]">Abriendo tu entrada…</p>
        ) : !record ? (
          <div className="mt-4 rounded-xl bg-[#fff4d6] p-4 text-left text-sm">
            <p className="font-semibold">Necesitas internet una vez para abrir esta entrada.</p>
            <p className="mt-1 text-xs">Conéctate y vuelve a abrir esta página: después el QR funciona aunque no haya señal en el lugar.</p>
            <button type="button" onClick={() => void sync()} className="mt-2 text-xs font-semibold underline">
              Reintentar
            </button>
          </div>
        ) : (
          <>
            <div className="relative mx-auto my-4 w-64">
              <div
                className={`aspect-square w-full overflow-hidden rounded-xl bg-white p-1 [&>svg]:h-full [&>svg]:w-full ${used ? "opacity-25" : ""}`}
                dangerouslySetInnerHTML={{ __html: shown?.svg ?? "" }}
                aria-label="QR de tu entrada, cambia cada 30 segundos"
                role="img"
              />
              {used && <p className="absolute inset-0 flex items-center justify-center text-xl font-extrabold text-[#14181b]">YA UTILIZADA</p>}
            </div>
            {/* Barra viva: una captura se nota quieta y vencida. */}
            <div className="mx-auto h-2 w-64 overflow-hidden rounded-full bg-[#d8d5cc]" aria-hidden>
              <div className="dyn-bar h-full rounded-full bg-[#0f8a6b]" style={{ width: `${(secondsLeft / STEP_SECONDS) * 100}%` }} />
            </div>
            <p className="mt-1 text-xs text-[#6b687a]" aria-live="off">
              Cambia en {Math.ceil(secondsLeft)} s
            </p>
            <div className="mt-3 border-t border-[#d8d5cc] pt-3">
              <p className="text-xs text-[#6b687a]">Si el lector falla, dicta el código y este número:</p>
              <p className="font-mono text-sm tracking-wider">{formatCode(code)}</p>
              <p className="font-mono text-2xl font-bold tracking-widest">{otp || "···"}</p>
            </div>
          </>
        )}
      </div>

      {record && !problem && (
        <p className="text-center text-xs text-[var(--ink-muted)]">
          {online ? "✓ Lista para usar sin internet." : "Sin internet: el QR sigue funcionando."} Sube el brillo de la pantalla antes de llegar a la puerta.
        </p>
      )}
      <p className="text-center text-xs text-[var(--ink-dim)]">
        No sirve una captura de pantalla: el QR cambia cada {STEP_SECONDS} segundos. Muéstralo en vivo.
      </p>
    </div>
  );
}
