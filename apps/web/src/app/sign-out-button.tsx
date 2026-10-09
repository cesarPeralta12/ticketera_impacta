"use client";

import { purgeAllKeys } from "./entrada/offline-store";

/** "Salir": además de cerrar la sesión, borra del celular las llaves y las páginas de las entradas guardadas. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <button
      type="submit"
      className={className}
      onClick={() => {
        void purgeAllKeys().catch(() => {});
        navigator.serviceWorker?.controller?.postMessage("purge");
      }}
    >
      Salir
    </button>
  );
}
