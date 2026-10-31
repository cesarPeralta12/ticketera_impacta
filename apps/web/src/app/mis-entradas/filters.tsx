"use client";

import { useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

type Props = {
  q: string;
  dia: string;
  tipo: string;
  estado: string;
  ver: string;
};

/**
 * Buscador de «Mis entradas»: los filtros viajan en la dirección (?q=…&tipo=…), así se pueden recargar y compartir.
 * Se aplican solos: al elegir en un desplegable o 0,4 s después de dejar de escribir.
 */
export function TicketFilters({ q, dia, tipo, estado, ver }: Props) {
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
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const filtered = Boolean(q || dia || tipo || estado);

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
        if (target instanceof HTMLInputElement && target.type === "search") timer.current = setTimeout(apply, 400);
        else apply();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="ver" value={ver === "pasadas" ? "pasadas" : ""} />
      <label className="grow basis-56 text-xs text-[var(--ink-muted)]">
        Buscar
        <input type="search" name="q" defaultValue={q} placeholder="Evento, lugar, tipo, mesa o código" autoComplete="off" className="field mt-1 w-full" />
      </label>
      <label className="text-xs text-[var(--ink-muted)]">
        Día
        <input type="date" name="dia" defaultValue={dia} className="field mt-1" />
      </label>
      <label className="text-xs text-[var(--ink-muted)]">
        Qué
        <select name="tipo" defaultValue={tipo} className="field mt-1">
          <option value="">Entradas y consumo</option>
          <option value="entradas">Solo entradas</option>
          <option value="consumo">Solo QR de consumo</option>
        </select>
      </label>
      <label className="text-xs text-[var(--ink-muted)]">
        Estado
        <select name="estado" defaultValue={estado} className="field mt-1">
          <option value="">Todas</option>
          <option value="sin-usar">Sin usar</option>
          <option value="usadas">Usadas o leídas</option>
        </select>
      </label>
      {filtered && (
        <button type="button" onClick={() => router.replace(ver === "pasadas" ? `${pathname}?ver=pasadas` : pathname, { scroll: false })} className="pb-2 text-xs text-[var(--accent-text)] hover:underline">
          Limpiar filtros
        </button>
      )}
    </form>
  );
}
