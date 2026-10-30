"use client";

import { useMemo, useState } from "react";

export type DoorPickGate = { id: string; name: string; out: boolean };

export type DoorPickSession = {
  id: string;
  title: string;
  /** "sáb 31 oct · 22:00" ya en la hora del recinto. */
  when: string;
  /** Día en la hora del recinto (YYYY-MM-DD), para filtrar por fecha. */
  day: string;
  venueId: string;
  venueName: string;
  clientName: string | null;
  nightlife: boolean;
  published: boolean;
  gates: DoorPickGate[];
  /** Puerta con la que ya está asignada a este portero (si la tiene). */
  assignedGate: string | null;
};

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * Elegir la función (y la puerta) de un portero entre muchas: busca por nombre del evento, recinto o cliente, y
 * filtra por tipo (boliches o eventos), cliente y fecha. La puerta se elige entre las del recinto de la función.
 * Manda `sessionId` y `accessPointId` dentro del formulario que lo contiene.
 */
export function DoorSessionPicker({ sessions }: { sessions: DoorPickSession[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "nightlife" | "events">("all");
  const [client, setClient] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const [selectedId, setSelectedId] = useState("");

  const clients = useMemo(() => [...new Set(sessions.map((s) => s.clientName).filter((c): c is string => Boolean(c)))].toSorted((a, b) => a.localeCompare(b, "es")), [sessions]);
  const hasNightlife = sessions.some((s) => s.nightlife);
  const hasEvents = sessions.some((s) => !s.nightlife);

  const results = useMemo(() => {
    // Varias palabras, en cualquier orden: «sáb 14 lounge» encuentra «sáb, 14 nov · Lounge 360».
    const words = normalize(query).split(/[\s,]+/).filter(Boolean);
    return sessions.filter((s) => {
      if (kind === "nightlife" && !s.nightlife) return false;
      if (kind === "events" && s.nightlife) return false;
      if (client && s.clientName !== client) return false;
      if (from && s.day < from) return false;
      if (to && s.day > to) return false;
      if (onlyFree && s.assignedGate) return false;
      if (words.length > 0) {
        const haystack = normalize(`${s.title} ${s.venueName} ${s.clientName ?? ""} ${s.when}`);
        if (!words.every((w) => haystack.includes(w))) return false;
      }
      return true;
    });
  }, [sessions, query, kind, client, from, to, onlyFree]);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const filtered = Boolean(query || client || from || to || onlyFree || kind !== "all");

  function clearFilters() {
    setQuery("");
    setKind("all");
    setClient("");
    setFrom("");
    setTo("");
    setOnlyFree(false);
  }

  function quick(days: number) {
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + days);
    setFrom(isoDay(start));
    setTo(isoDay(end));
  }

  return (
    <div className="w-full space-y-3">
      <input type="hidden" name="sessionId" value={selectedId} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="label grow basis-56">
          Buscar
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Evento, boliche, recinto o cliente"
            className="field"
            autoComplete="off"
          />
        </label>
        {hasNightlife && hasEvents && (
          <label className="label">
            Tipo
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="field">
              <option value="all">Todos</option>
              <option value="nightlife">Boliches (noches)</option>
              <option value="events">Eventos</option>
            </select>
          </label>
        )}
        {clients.length > 0 && (
          <label className="label">
            Cliente
            <select value={client} onChange={(e) => setClient(e.target.value)} className="field">
              <option value="">Todos</option>
              {clients.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="label">
          Desde
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="field" />
        </label>
        <label className="label">
          Hasta
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="field" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => quick(0)} className="btn px-2.5 py-1 text-xs">
          Hoy
        </button>
        <button type="button" onClick={() => quick(2)} className="btn px-2.5 py-1 text-xs">
          Próximos 3 días
        </button>
        <button type="button" onClick={() => quick(7)} className="btn px-2.5 py-1 text-xs">
          Próximos 7 días
        </button>
        <label className="ml-2 flex items-center gap-1.5 text-[var(--ink-muted)]">
          <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} className="accent-[var(--accent)]" /> Solo sin asignar
        </label>
        {filtered && (
          <button type="button" onClick={clearFilters} className="text-xs text-[var(--accent)] hover:underline">
            Limpiar filtros
          </button>
        )}
        <span className="ml-auto text-xs text-[var(--ink-dim)]">
          {results.length} de {sessions.length} funciones
        </span>
      </div>

      {results.length === 0 ? (
        <p className="rounded-md bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">
          Ninguna función coincide con la búsqueda.{" "}
          {filtered && (
            <button type="button" onClick={clearFilters} className="font-semibold underline">
              Limpiar filtros
            </button>
          )}
        </p>
      ) : (
        <ul role="radiogroup" aria-label="Función" className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)]">
          {results.map((s) => {
            const active = s.id === selectedId;
            return (
              <li key={s.id}>
                <label className={`flex cursor-pointer items-start gap-3 px-4 py-3 text-sm ${active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-2)]"}`}>
                  <input type="radio" name="pick" checked={active} onChange={() => setSelectedId(s.id)} className="mt-1 accent-[var(--accent)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {s.title}
                      {!s.published && <span className="font-normal text-[var(--ink-dim)]"> (todavía no publicado)</span>}
                    </span>
                    <span className="block text-[var(--ink-muted)]">
                      {s.when} · {s.venueName}
                      {s.clientName ? ` · ${s.clientName}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {s.nightlife && <span className="badge bg-[var(--surface-2)] text-[var(--ink-muted)]">Boliche</span>}
                    {s.assignedGate && <span className="badge bg-[var(--success-soft)] text-[var(--success)]">asignada · {s.assignedGate}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="label">
          Puerta{selected ? ` de ${selected.venueName}` : ""}
          {/* key: al cambiar de recinto se vuelve a elegir; con una sola puerta queda elegida. */}
          <select key={selected?.venueId ?? "ninguno"} name="accessPointId" required defaultValue={selected?.gates.length === 1 ? selected.gates[0]!.id : (selected?.gates.find((g) => g.name === selected.assignedGate)?.id ?? "")} disabled={!selected} className="field min-w-48">
            <option value="" disabled>
              {selected ? "Elige la puerta" : "Primero elige la función"}
            </option>
            {selected?.gates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.out && !/salida/i.test(g.name) ? " (salida)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!selected} className="btn btn-primary">
          Asignar
        </button>
        {selected && selected.gates.length === 0 && (
          <p className="basis-full text-sm text-[var(--warn)]">El recinto {selected.venueName} no tiene puertas: créalas en Recintos y vuelve aquí.</p>
        )}
      </div>
    </div>
  );
}
