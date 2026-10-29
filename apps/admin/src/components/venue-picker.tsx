"use client";

import { useRef, useState } from "react";
import { VenueThumbnail } from "./venue-thumbnail";
import type { VenueChoice } from "@/lib/venue-choices";

const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Recinto de una función: en vez de una lista larga, una ventana con una tarjeta por recinto (miniatura del mapa,
 * secciones y aforo), agrupados por ciudad y con buscador. El elegido viaja en el formulario como `venueId`.
 */
export function VenuePicker({
  venues,
  value,
  onChange,
  newVenueOption = false,
}: {
  venues: VenueChoice[];
  value: string;
  onChange: (venueId: string) => void;
  /** Asistente: la primera tarjeta es "un lugar nuevo" (sus datos van en otros campos del formulario). */
  newVenueOption?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const chosen = venues.find((v) => v.id === value);

  const q = plain(query.trim());
  const found = q ? venues.filter((v) => plain(`${v.name} ${v.city ?? ""}`).includes(q)) : venues;
  const byCity = new Map<string, VenueChoice[]>();
  for (const v of found) byCity.set(v.city?.trim() || "Sin ciudad", [...(byCity.get(v.city?.trim() || "Sin ciudad") ?? []), v]);
  // Primero la ciudad con más recintos; "Sin ciudad" al final.
  const groups = [...byCity].toSorted(([a, x], [b, y]) => (a === "Sin ciudad" ? 1 : b === "Sin ciudad" ? -1 : y.length - x.length || a.localeCompare(b)));

  function open() {
    setQuery("");
    dialogRef.current?.showModal();
    // Con mouse se puede escribir de una; en el celular no se abre el teclado encima de las tarjetas.
    if (window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus();
  }

  function choose(id: string) {
    onChange(id);
    dialogRef.current?.close();
  }

  const card = "card flex flex-col gap-2 p-3 text-left transition-colors hover:border-[var(--accent)]";
  const selected = "border-[var(--accent)] bg-[var(--accent-soft)]";

  return (
    <div className="label">
      Recinto
      <input type="hidden" name="venueId" value={value} />
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={open}
        className="field flex min-w-64 items-center justify-between gap-3 text-left"
      >
        <span className="truncate">{chosen ? `${chosen.name}${chosen.city ? ` (${chosen.city})` : ""}` : "Un lugar nuevo (lo escribo abajo)"}</span>
        <span className="shrink-0 text-xs font-medium text-[var(--accent)]">Elegir</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Elegir recinto"
        className="m-auto w-[min(60rem,calc(100vw-2rem))] max-w-none rounded-xl border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--ink)] shadow-2xl backdrop:bg-black/40"
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
            <h2 className="font-semibold">Elegir recinto</h2>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Cerrar" className="rounded p-1 text-lg leading-none text-[var(--ink-muted)] hover:bg-[var(--surface-2)]">
              ×
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            {venues.length > 4 && (
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Enter no envía el formulario del evento.
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                placeholder={`Buscar entre ${venues.length} recintos por nombre o ciudad…`}
                className="field w-full"
              />
            )}

            {newVenueOption && !q && (
              <button type="button" onClick={() => choose("")} className={`${card} w-full flex-row items-center border-dashed ${value === "" ? selected : ""}`}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xl">+</span>
                <span>
                  <span className="block font-medium">Un lugar nuevo</span>
                  <span className="text-xs text-[var(--ink-muted)]">Escribes abajo su nombre y aforo; queda como una zona general.</span>
                </span>
              </button>
            )}

            {groups.map(([city, list]) => (
              <section key={city} className="space-y-2">
                {byCity.size > 1 && (
                  <h3 className="eyebrow">
                    {city} · {list.length}
                  </h3>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((v) => (
                    <button key={v.id} type="button" onClick={() => choose(v.id)} aria-pressed={v.id === value} className={`${card} ${v.id === value ? selected : ""}`}>
                      {v.thumb.items.length + v.thumb.zones.length + v.thumb.seats.length > 0 ? (
                        <VenueThumbnail data={v.thumb} />
                      ) : (
                        <span className="grid aspect-[1000/640] w-full place-items-center rounded-md border border-dashed border-[var(--border)] text-xs text-[var(--ink-dim)]">
                          Sin mapa dibujado
                        </span>
                      )}
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-medium">{v.name}</span>
                        {v.id === value && <span className="badge shrink-0 bg-[var(--accent)] text-white">Elegido</span>}
                      </span>
                      <span className="text-xs text-[var(--ink-muted)]">{v.detail}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}

            {found.length === 0 && <p className="py-6 text-center text-sm text-[var(--ink-muted)]">Ningún recinto se llama así.</p>}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3 text-sm">
            <a href="/recintos" target="_blank" rel="noopener" className="text-[var(--ink-muted)] hover:text-[var(--ink)] hover:underline">
              Crear o editar recintos (se abre aparte) ↗
            </a>
            <button type="button" onClick={() => dialogRef.current?.close()} className="btn btn-dark">
              Listo
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
