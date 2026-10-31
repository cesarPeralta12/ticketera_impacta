"use client";

import { useRef, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";

/**
 * Filtros de una lista: los campos viajan en la dirección de la página (?q=…&estado=…), así se pueden compartir y
 * recargar. Se aplican solos: al elegir en un desplegable, al marcar una casilla o 0,4 s después de dejar de escribir.
 * Cualquier cambio vuelve a la primera página.
 */
export function FilterForm({ children, clearLabel = "Limpiar filtros" }: { children: ReactNode; clearLabel?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function apply() {
    const form = formRef.current;
    if (!form) return;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string" && value.trim() !== "") params.set(key, value.trim());
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <form
      ref={formRef}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        clearTimeout(timer.current);
        apply();
      }}
      onChange={(e) => {
        const target = e.target as HTMLElement;
        clearTimeout(timer.current);
        if (target instanceof HTMLInputElement && (target.type === "search" || target.type === "text")) timer.current = setTimeout(apply, 400);
        else apply();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      {children}
      <button type="button" onClick={() => router.replace(pathname)} className="pb-2 text-xs text-[var(--accent)] hover:underline">
        {clearLabel}
      </button>
    </form>
  );
}
