"use client";

import { useSearchParams } from "next/navigation";

/** Aviso al volver de "Cambiar contraseña" (la acción redirige con ?clave=ok). */
export function PasswordNotice() {
  const params = useSearchParams();
  if (params.get("clave") !== "ok") return null;
  return (
    <div role="status" className="border-b border-[var(--border)] bg-[var(--accent-soft)] px-4 py-2.5 text-sm text-[var(--accent)] md:px-8 print:hidden">
      Contraseña guardada: desde ahora entras con la nueva.
    </div>
  );
}
