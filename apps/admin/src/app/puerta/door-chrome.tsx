"use client";

import { useEffect } from "react";
import { signOutAction } from "./actions";
import { clearAll, pendingCount } from "./offline-store";

/** Registra el service worker (solo en producción: en desarrollo interfiere con la recarga en caliente). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  }, []);
  return null;
}

/**
 * Salir borra lo guardado en el equipo (la lista tiene nombres de asistentes). Si hay
 * lecturas sin subir, avisa: se perderían.
 */
export function DoorSignOut() {
  async function onClick() {
    let pending = 0;
    try {
      pending = await pendingCount();
    } catch {
      // sin IndexedDB no hay nada guardado
    }
    const message = pending
      ? `Hay ${pending} lectura(s) sin subir. Si sales ahora se pierden. Conéctate a internet y espera a que se suban. ¿Salir igual?`
      : "¿Cerrar sesión en este equipo?";
    if (!window.confirm(message)) return;
    try {
      await clearAll();
    } catch {
      // nada que borrar
    }
    await signOutAction();
  }
  return (
    <button type="button" onClick={onClick} className="rounded-md bg-white/10 px-3 py-1.5 text-xs">
      Salir
    </button>
  );
}
