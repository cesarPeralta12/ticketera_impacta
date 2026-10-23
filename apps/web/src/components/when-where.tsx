import { timeZoneLabel, type WhenWhere } from "@ticketera/core";

/**
 * "Cuándo y dónde" de una función: horarios, lugar y cómo llegar, condiciones, programa y contacto. El mismo bloque
 * en la página del evento, la compra, la orden y las entradas (los textos salen de whenWhere, en core).
 * `compact`: sin programa, estacionamiento ni reembolsos (para las tarjetas de Mis entradas).
 */
export function WhenWhereBlock({ data, compact = false, className = "" }: { data: WhenWhere; compact?: boolean; className?: string }) {
  const { when, place, contact } = data;
  return (
    <section className={`card grid gap-5 p-5 text-sm sm:grid-cols-2 ${className}`}>
      <div className="space-y-1">
        <p className="eyebrow">Cuándo</p>
        <p className="font-semibold first-letter:uppercase">{when.day}</p>
        <p className="text-[var(--ink-muted)]">{[when.doors, when.start, when.lastEntry].filter(Boolean).join(" · ")}</p>
        {when.end && <p className="text-[var(--ink-muted)]">{when.end}</p>}
        {when.arrival && <p className="font-medium text-[var(--accent-text)]">{when.arrival}</p>}
        <p className="text-xs text-[var(--ink-dim)]">{timeZoneLabel(data.timeZone)}</p>
      </div>

      <div className="space-y-1">
        <p className="eyebrow">Dónde</p>
        <p className="font-semibold">{place.name}</p>
        {place.address && <p className="text-[var(--ink-muted)]">{place.address}</p>}
        {place.directions && <p className="text-[var(--ink-muted)]">Cómo llegar: {place.directions}</p>}
        {!compact && place.parking && <p className="text-[var(--ink-muted)]">Estacionamiento: {place.parking}</p>}
        {!compact && place.accessibility && <p className="text-[var(--ink-muted)]">Accesibilidad: {place.accessibility}</p>}
        {place.mapUrl && (
          <a href={place.mapUrl} target="_blank" rel="noopener noreferrer" className="inline-block font-medium text-[var(--accent-text)] hover:underline">
            Ver en el mapa →
          </a>
        )}
      </div>

      {data.conditions.length > 0 && (
        <div className="space-y-1">
          <p className="eyebrow">Condiciones</p>
          <ul className="space-y-0.5 text-[var(--ink-muted)]">
            {data.conditions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {!compact && data.program.length > 0 && (
        <div className="space-y-1">
          <p className="eyebrow">Programa</p>
          <ul className="space-y-0.5">
            {data.program.map((p) => (
              <li key={`${p.time}-${p.name}`}>
                <span className="font-mono text-[var(--accent-text)]">{p.time}</span> <span className="font-medium">{p.name}</span>
                {p.note && <span className="text-[var(--ink-dim)]"> · {p.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(contact.whatsapp || contact.phone || contact.email) && (
        <div className="space-y-1">
          <p className="eyebrow">Consultas</p>
          {contact.whatsapp ? (
            <a href={contact.whatsapp} target="_blank" rel="noopener noreferrer" className="block text-[var(--accent-text)] hover:underline">
              WhatsApp {contact.phone}
            </a>
          ) : (
            contact.phone && <p className="text-[var(--ink-muted)]">{contact.phone}</p>
          )}
          {contact.email && (
            <a href={`mailto:${contact.email}`} className="block text-[var(--accent-text)] hover:underline">
              {contact.email}
            </a>
          )}
        </div>
      )}

      {!compact && data.refundPolicy && (
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-[var(--ink-muted)] hover:text-[var(--ink)]">Cambios y reembolsos</summary>
          <p className="mt-2 whitespace-pre-wrap text-[var(--ink-muted)]">{data.refundPolicy}</p>
        </details>
      )}
    </section>
  );
}
