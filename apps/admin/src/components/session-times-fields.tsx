"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_TIMEZONE,
  MAX_CLOSE_HOURS_BEFORE,
  describeSessionTimes,
  formatDateTime,
  parseSalesWindow,
  parseSessionTimes,
  startLabel,
  timeZoneLabel,
  type SalesInput,
  type SessionTimesInput,
} from "@ticketera/core";

export type SessionFormDefaults = SessionTimesInput & SalesInput;
type Venue = { id: string; name: string; city: string | null; timezone: string };
type Values = SessionFormDefaults & { venueId?: string };

const FIELDS = ["venueId", "date", "start", "doors", "arrival", "end", "lastEntry", "open", "openAt", "close", "closeHours", "closeAt"] as const;

function readValues(element: HTMLElement | null): Values {
  const form = element?.closest("form");
  const next: Values = {};
  if (form) {
    const data = new FormData(form);
    for (const key of FIELDS) {
      const value = data.get(key);
      if (typeof value === "string" && value !== "") next[key] = value;
    }
  }
  return { open: "publish", close: "start", ...next };
}

/**
 * Cuándo es una función y cuándo se vende, ordenado por la pregunta que responde cada campo. Las horas son del
 * reloj del recinto: las puertas y la llegada se entienden antes del inicio y el fin después (de madrugada, al día
 * siguiente). Abajo, la línea de tiempo y lo que verá el comprador, en vivo.
 */
export function SessionTimesFields({
  category,
  venues,
  newVenueOption = false,
  timeZone,
  defaults = {},
}: {
  category: string;
  /** Al crear: el recinto se elige aquí (y con él la zona horaria). */
  venues?: Venue[];
  /** Asistente: la lista empieza con "un lugar nuevo" (sus datos van en otros campos del formulario). */
  newVenueOption?: boolean;
  /** Al editar: la zona horaria del recinto de la función. */
  timeZone?: string;
  defaults?: SessionFormDefaults;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Values>({ venueId: newVenueOption ? "" : venues?.[0]?.id, open: "publish", close: "start", ...defaults });

  // Los campos no son controlados (el formulario se limpia solo al guardar): se leen para el resumen.
  const read = () => setValues(readValues(ref.current));
  useEffect(() => {
    const element = ref.current;
    const form = element?.closest("form");
    const onReset = () => setTimeout(() => setValues(readValues(element)), 0);
    form?.addEventListener("reset", onReset);
    return () => form?.removeEventListener("reset", onReset);
  }, []);

  const tz = venues ? (venues.find((v) => v.id === values.venueId)?.timezone ?? DEFAULT_TIMEZONE) : (timeZone ?? DEFAULT_TIMEZONE);
  const times = parseSessionTimes(values, tz);
  const sales = times.ok ? parseSalesWindow(values, times.times, tz) : null;
  const when = times.ok ? describeSessionTimes(times.times, tz, category) : null;
  const nightlife = category === "BOLICHE";
  const fmt = (d: Date) => formatDateTime(d, tz);

  // Línea de tiempo: de la venta al cierre, en orden (en un boliche la venta online puede cerrar durante la noche).
  const steps: { label: string; at: string }[] = [];
  if (times.ok && sales?.ok) {
    const t = times.times;
    const dated: { label: string; date: Date }[] = [{ label: "Cierra la venta online", date: sales.window.salesEndAt ?? t.startsAt }];
    if (sales.window.salesStartAt) dated.push({ label: "Abre la venta", date: sales.window.salesStartAt });
    if (t.arrivalAt) dated.push({ label: "Llegada", date: t.arrivalAt });
    if (t.doorsOpenAt) dated.push({ label: "Puertas", date: t.doorsOpenAt });
    dated.push({ label: startLabel(category), date: t.startsAt });
    if (t.lastEntryAt) dated.push({ label: "Último ingreso", date: t.lastEntryAt });
    if (t.endsAt) dated.push({ label: "Termina", date: t.endsAt });
    if (!sales.window.salesStartAt) steps.push({ label: "Abre la venta", at: "al publicar" });
    for (const d of dated.toSorted((a, b) => a.date.getTime() - b.date.getTime())) steps.push({ label: d.label, at: fmt(d.date) });
  }
  const problem = !times.ok ? times.message : sales && !sales.ok ? sales.message : null;

  return (
    <div ref={ref} onChange={read} className="w-full space-y-5">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          Cuándo <span className="font-normal text-[var(--ink-dim)]">· {timeZoneLabel(tz)}</span>
        </legend>
        <div className="flex flex-wrap items-start gap-3">
          {venues && (
            <label className="label">
              Recinto
              <select name="venueId" required={!newVenueOption} defaultValue={values.venueId} className="field">
                {newVenueOption && <option value="">Un lugar nuevo (lo escribo abajo)</option>}
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.city ? ` (${v.city})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="label">
            Día
            <input type="date" name="date" required defaultValue={defaults.date} className="field" />
          </label>
          <Field name="doors" label="Abren las puertas" help="Desde esta hora la gente puede entrar." defaultValue={defaults.doors} />
          <Field name="start" label={startLabel(category)} help="Lo principal. Es la hora que ve el público." defaultValue={defaults.start} required />
          <Field
            name="end"
            label="Termina"
            help={nightlife ? "Hora de cierre: de madrugada es el día siguiente." : "Hora estimada. Si es de madrugada, es el día siguiente."}
            defaultValue={defaults.end}
          />
          <Field name="arrival" label="Llegada recomendada (opcional)" help="Vacía = la de las puertas." defaultValue={defaults.arrival} />
          <Field
            name="lastEntry"
            label="Último ingreso (opcional)"
            help="Después ya no entra nadie. Las entradas con horario propio (la free) usan el suyo."
            defaultValue={defaults.lastEntry}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Venta online</legend>
        <div className="flex flex-wrap items-start gap-3">
          <label className="label">
            Abre la venta
            <select name="open" defaultValue={defaults.open ?? "publish"} className="field">
              <option value="publish">Al publicar</option>
              <option value="date">En una fecha</option>
            </select>
          </label>
          {values.open === "date" && (
            <label className="label">
              Desde
              <input type="datetime-local" name="openAt" required defaultValue={defaults.openAt} className="field" />
            </label>
          )}
          <label className="label">
            Cierra la venta
            <select name="close" defaultValue={defaults.close ?? "start"} className="field">
              <option value="start">Cuando empieza</option>
              <option value="hours">Unas horas antes</option>
              <option value="date">{nightlife ? "En una fecha (puede ser durante la noche)" : "En una fecha"}</option>
            </select>
          </label>
          {values.close === "hours" && (
            <label className="label">
              Horas antes
              <input name="closeHours" type="number" min={1} max={MAX_CLOSE_HOURS_BEFORE} required defaultValue={defaults.closeHours ?? 2} className="field w-24" />
            </label>
          )}
          {values.close === "date" && (
            <label className="label">
              Hasta
              <input type="datetime-local" name="closeAt" required defaultValue={defaults.closeAt} className="field" />
            </label>
          )}
        </div>
        <p className="text-xs text-[var(--ink-dim)]">
          La boletería sigue vendiendo en puerta hasta que termina. Cada entrada puede tener además sus propias fechas
          (preventa).
        </p>
      </fieldset>

      {(steps.length > 0 || problem) && (
        <div className="rounded-md bg-[var(--surface-2)] px-4 py-3 text-sm">
          {problem ? (
            <p className="text-[var(--danger)]">{problem}</p>
          ) : (
            <>
              <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {steps.map((s, i) => (
                  <li key={s.label} className="flex items-center gap-2">
                    {i > 0 && <span className="text-[var(--ink-dim)]">→</span>}
                    <span>
                      <span className="text-[var(--ink-muted)]">{s.label}:</span> <span className="font-mono">{s.at}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {when && (
                <p className="mt-2 text-[var(--ink-muted)]">
                  El comprador ve: <span className="text-[var(--ink)]">{when.day[0]!.toUpperCase() + when.day.slice(1)}</span>
                  {" · "}
                  {[when.doors, when.start, when.lastEntry, when.end].filter(Boolean).join(" · ")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ name, label, help, defaultValue, required }: { name: string; label: string; help: string; defaultValue?: string; required?: boolean }) {
  return (
    <label className="label max-w-[11rem]">
      {label}
      <input type="time" name={name} required={required} defaultValue={defaultValue} className="field" />
      <span className="text-xs font-normal text-[var(--ink-dim)]">{help}</span>
    </label>
  );
}
