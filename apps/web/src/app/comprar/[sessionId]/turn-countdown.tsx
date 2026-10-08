"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Tiempo que le queda al comprador para elegir antes de volver a la fila. */
export function TurnCountdown({ endsAt, sessionId }: { endsAt: string; sessionId: string }) {
  const router = useRouter();
  const deadline = new Date(endsAt).getTime();
  const [left, setLeft] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    const id = setInterval(() => {
      const ms = Math.max(0, deadline - Date.now());
      setLeft(ms);
      if (ms === 0) {
        clearInterval(id);
        router.replace(`/comprar/${sessionId}/espera`);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [deadline, router, sessionId]);

  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  // Latido: mientras la persona sigue eligiendo, avisa que sigue aquí para no perder el turno por "inactividad".
  useEffect(() => {
    let cancelled = false;
    async function beat() {
      try {
        const response = await fetch(`/api/cola/${sessionId}`, { cache: "no-store" });
        const data = (await response.json()) as { state?: string };
        if (!cancelled && (data.state === "finished" || data.state === "not_joined" || data.state === "waiting")) {
          router.replace(`/comprar/${sessionId}/espera`);
        }
      } catch {
        // Sin conexión un momento: se reintenta en el próximo latido.
      }
    }
    const id = setInterval(beat, 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [router, sessionId]);

  return (
    <p className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-3 text-sm">
      Es tu turno: tienes{" "}
      <span className="font-mono font-semibold tabular-nums">
        {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
      </span>{" "}
      para elegir y reservar tus entradas.
    </p>
  );
}
