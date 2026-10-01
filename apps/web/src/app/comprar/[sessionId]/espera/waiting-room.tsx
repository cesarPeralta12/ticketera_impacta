"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Status =
  | { state: "connecting" }
  | { state: "open" }
  | { state: "admitted" }
  | { state: "waiting"; position: number; waiting: number }
  | { state: "finished" }
  | { state: "not_joined" }
  | { state: "error" };

const POLL_MS = 3000;

/**
 * Una sola inscripción en curso por función. Sin esto, dos llamadas casi simultáneas
 * (React ejecuta los efectos dos veces en desarrollo, doble clic, etc.) salen antes de que
 * exista la cookie y crean dos lugares en la fila: el "fantasma" ocuparía un turno sin
 * que nadie compre.
 */
const pendingJoins = new Map<string, Promise<Response>>();

function joinOnce(sessionId: string): Promise<Response> {
  let join = pendingJoins.get(sessionId);
  if (!join) {
    join = fetch(`/api/cola/${sessionId}`, { method: "POST", cache: "no-store" });
    pendingJoins.set(sessionId, join);
    join.finally(() => setTimeout(() => pendingJoins.delete(sessionId), 10_000));
  }
  return join.then((response) => response.clone());
}

/** Sala de espera (interfaz del prototipo del compañero, con consulta periódica en vez de SSE). */
export function WaitingRoom({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ state: "connecting" });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function call(method: "POST" | "GET") {
      try {
        const response =
          method === "POST"
            ? await joinOnce(sessionId)
            : await fetch(`/api/cola/${sessionId}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as Status;
        if (cancelled) return;
        setStatus(data);
        if (data.state === "admitted" || data.state === "open") {
          router.replace(`/comprar/${sessionId}`);
          return;
        }
        // Si su turno anterior terminó, vuelve a anotarse al final de la fila.
        timer = setTimeout(() => call(data.state === "finished" || data.state === "not_joined" ? "POST" : "GET"), POLL_MS);
      } catch {
        if (cancelled) return;
        setStatus({ state: "error" });
        timer = setTimeout(() => call("GET"), POLL_MS * 2);
      }
    }

    call("POST");
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, router]);

  return (
    <div className="flex flex-col items-center gap-4 text-center" aria-live="polite">
      {status.state === "connecting" && <p className="text-[var(--ink-muted)]">Entrando a la sala de espera…</p>}
      {status.state === "waiting" && (
        <>
          <p className="font-display text-7xl text-[var(--accent)]">{status.position}</p>
          <p className="text-[var(--ink-muted)]">
            tu lugar en la fila · {status.waiting === 1 ? "1 persona esperando" : `${status.waiting} personas esperando`}
          </p>
        </>
      )}
      {(status.state === "admitted" || status.state === "open") && (
        <p className="font-display text-2xl text-[var(--green)]">¡Es tu turno! Entrando…</p>
      )}
      {status.state === "error" && (
        <p className="text-[var(--accent-2)]">Se perdió la conexión. Reintentando… no cierres esta página.</p>
      )}
    </div>
  );
}
