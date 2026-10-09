"use client";

import { useEffect, useState } from "react";
import { purgeStaleKeys, syncKey } from "../entrada/offline-store";

/**
 * Deja las entradas de QR dinámico listas para usar SIN internet: con conexión, baja la llave de cada una y guarda
 * su página. Es lo que hace posible mostrar el QR en un estadio sin señal.
 */
export function OfflineReady({ userId, codes }: { userId: string; codes: string[] }) {
  const [state, setState] = useState<{ ready: number; failed: number } | "working" | "offline">("working");

  useEffect(() => {
    let cancelled = false;
    if (typeof crypto === "undefined" || !crypto.subtle || !navigator.onLine) {
      queueMicrotask(() => setState("offline"));
      return;
    }
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    (async () => {
      await purgeStaleKeys(userId).catch(() => {});
      let ready = 0;
      let failed = 0;
      for (const code of codes) {
        const result = await syncKey(code, userId);
        if (result.ok) {
          // Guarda también la página de la entrada (el service worker la copia al pasar por él).
          await fetch(`/entrada/${code}`, { credentials: "same-origin" }).catch(() => {});
          ready++;
        } else if (result.status !== "offline") failed++;
        if (cancelled) return;
      }
      setState({ ready, failed });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, codes]);

  if (state === "working") return <p className="text-xs text-[var(--ink-dim)]">Preparando tus entradas para usarlas sin internet…</p>;
  if (state === "offline") return <p className="text-xs text-[var(--ink-dim)]">Sin conexión: se usarán las entradas que ya abriste antes con internet.</p>;
  return (
    <p role="status" className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-3 text-sm">
      {state.ready > 0 ? `✓ ${state.ready} ${state.ready === 1 ? "entrada lista" : "entradas listas"} para usar sin internet. ` : ""}
      {state.failed > 0 ? `${state.failed} no se pudo preparar. ` : ""}
      Instala el sitio en tu pantalla de inicio (menú del navegador → Agregar a pantalla de inicio) para abrirlas más rápido.
    </p>
  );
}
