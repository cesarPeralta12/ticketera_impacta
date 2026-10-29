"use client";

import { useState } from "react";

export type PickerEvent = { id: string; title: string; sessions: { id: string; label: string }[] };

/**
 * Elegir un evento y qué funciones (todas, o algunas): manda `eventId` y una `sessionIds` por función marcada. Si se
 * marcan todas, se toma el evento completo (también las funciones que se agreguen después).
 */
export function EventSessionsPicker({
  events,
  defaultEventId,
  defaultSessionIds,
  required = true,
}: {
  events: PickerEvent[];
  defaultEventId?: string;
  /** Funciones marcadas al abrir (vacío o sin dato: todas). */
  defaultSessionIds?: string[];
  required?: boolean;
}) {
  const [eventId, setEventId] = useState(defaultEventId ?? events[0]?.id ?? "");
  const event = events.find((e) => e.id === eventId);
  const initial = (id: string) => (eventId === defaultEventId && defaultSessionIds && defaultSessionIds.length > 0 ? defaultSessionIds.includes(id) : true);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const isPicked = (id: string) => picked[`${eventId}:${id}`] ?? initial(id);
  const all = event ? event.sessions.every((s) => isPicked(s.id)) : true;

  function setAll(value: boolean) {
    if (!event) return;
    setPicked((p) => ({ ...p, ...Object.fromEntries(event.sessions.map((s) => [`${eventId}:${s.id}`, value])) }));
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      <label className="label">
        Evento
        <select name="eventId" required={required} value={eventId} onChange={(e) => setEventId(e.target.value)} className="field min-w-56">
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </label>
      {event && event.sessions.length > 1 && (
        <fieldset className="label">
          <legend className="mb-1.5">Funciones</legend>
          <div className="flex max-w-xl flex-wrap gap-x-4 gap-y-1.5 text-sm text-[var(--ink)]">
            <label className="flex items-center gap-1.5 font-medium">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-[var(--accent)]" /> Todas
            </label>
            {event.sessions.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="sessionIds"
                  value={s.id}
                  checked={isPicked(s.id)}
                  onChange={(e) => setPicked((p) => ({ ...p, [`${eventId}:${s.id}`]: e.target.checked }))}
                  className="accent-[var(--accent)]"
                />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {/* Todas marcadas (o una sola función): el evento completo, también las funciones que se agreguen después. */}
      {all && <input type="hidden" name="allSessions" value="1" />}
    </div>
  );
}
