import { isTablesLayout } from "@ticketera/core";
import { AccessMethodsField } from "@/components/access-methods-field";
import { ActionForm } from "@/components/action-form";
import { TicketModels } from "@/components/ticket-models";
import { addTicketTypeAction } from "@/lib/actions/events";

type SectionOption = { id: string; name: string; seatingMode: string; capacity: number; layout: unknown; seats: unknown[] };

/**
 * Formulario para agregar un precio (tipo de entrada) a una función, con los modelos General, VIP, Mesa, Free y
 * Preventa arriba. Se usa en la página de la función y en el paso "Entradas" del asistente.
 */
export function TicketTypeForm({
  sessionId,
  sectionOptions,
  pricedSections,
  nightlife,
  ticketing,
  presaleEnd,
}: {
  sessionId: string;
  /** Secciones del recinto, primero las que todavía no tienen precio. */
  sectionOptions: SectionOption[];
  pricedSections: Set<string | null>;
  nightlife: boolean;
  ticketing: boolean;
  /** Fin sugerido para el modelo Preventa ("2026-11-13T23:59"), o null. */
  presaleEnd: string | null;
}) {
  return (
    <ActionForm action={addTicketTypeAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <TicketModels presaleEnd={presaleEnd} />
      <label className="label">
        Sección
        <select name="sectionId" required className="field">
          {sectionOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.seatingMode === "RESERVED" ? `${s.seats.length} ${isTablesLayout(s.layout) ? "lounges" : "butacas"}` : `aforo ${s.capacity}`}
              {pricedSections.has(s.id) ? " (ya tiene precio)" : " (sin precio)"}
            </option>
          ))}
        </select>
      </label>
      <label className="label">
        Nombre
        <input name="name" required placeholder="General, VIP, Preventa…" className="field" />
      </label>
      <label className="label">
        Precio (Bs)
        <input name="price" required inputMode="decimal" placeholder="120" className="field w-28" />
      </label>
      <label className="label">
        Cupo
        <input name="capacity" type="number" min={1} placeholder="ej. 200" className="field w-28" />
        <span className="text-xs font-normal text-[var(--ink-dim)]">En butacas y lounges, el del mapa.</span>
      </label>
      <details data-section="club" open={nightlife} className="basis-full">
        <summary className="cursor-pointer text-sm font-medium text-[var(--accent)]">Mesa, consumo incluido u horario de ingreso (opcional)</summary>
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-dashed border-[#c04bff]/50 bg-[#f3e8ff]/40 p-3">
          <label className="flex items-center gap-2 self-center text-sm">
            <input type="checkbox" name="table" className="h-4 w-4" /> Es una mesa o lounge
          </label>
          <label className="label">
            Personas por mesa
            <input name="peoplePerUnit" type="number" min={2} max={50} placeholder="ej. 6" className="field w-28" />
          </label>
          <label className="label">
            Consumo incluido (Bs)
            <input name="consumption" inputMode="decimal" placeholder="ej. 1000" className="field w-32" />
          </label>
          <label className="label">
            Válida para entrar hasta
            <input name="entryUntil" type="time" className="field w-32" />
          </label>
          <ul className="basis-full space-y-0.5 text-xs text-[var(--ink-dim)]">
            <li>
              <strong>Mesa o lounge</strong>: marca la casilla, personas, consumo y el precio de la mesa. Con los
              lounges del plano, el comprador elige el suyo; en una zona sin mapa, pon en Cupo cuántas mesas hay.
            </li>
            <li>
              <strong>Entrada + trago</strong>: solo el consumo (ej. 25). <strong>Free hasta la 01:00</strong>: precio
              0 y &ldquo;Válida para entrar hasta&rdquo; 01:00.
            </li>
          </ul>
        </div>
      </details>
      <details data-section="more" className="basis-full">
        <summary className="cursor-pointer text-sm font-medium text-[var(--accent)]">
          Más opciones: preventa, descuento, lectura en puerta, máximo por compra
        </summary>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="label">
            Máx. por compra
            <input name="maxPerOrder" type="number" min={1} max={10} defaultValue={10} className="field w-24" />
          </label>
          <div className="label">
            Lectura en puerta
            <div className="flex h-[38px] items-center">
              <AccessMethodsField />
            </div>
          </div>
          {ticketing && (
            <label className="flex items-center gap-2 self-center text-sm" title="El QR cambia cada 30 segundos y solo se lee con QR. Solo venta online (no boletería ni invitaciones).">
              <input type="checkbox" name="qrDynamic" className="h-4 w-4 accent-[var(--accent)]" /> QR dinámico
            </label>
          )}
          <div className="flex basis-full flex-wrap items-end gap-3 rounded-md border border-dashed border-[var(--border)] p-3">
            <label className="flex items-center gap-2 self-center text-sm">
              <input type="checkbox" name="presale" className="h-4 w-4" /> Es preventa
            </label>
            <label className="label">
              Venta desde (vacío = igual que la función)
              <input type="datetime-local" name="salesStartAt" className="field" />
            </label>
            <label className="label">
              Venta hasta (vacío = igual que la función; obligatorio en preventa)
              <input type="datetime-local" name="salesEndAt" className="field" />
            </label>
            <label className="flex items-center gap-2 self-center text-sm">
              <input type="checkbox" name="exclusive" defaultChecked className="h-4 w-4" /> Mientras dure la preventa, no
              vender las otras entradas de esta sección
            </label>
            <p className="basis-full text-xs text-[var(--ink-dim)]">
              Hora del recinto. Ejemplo: &ldquo;Preventa&rdquo; a Bs 70 hasta el 20/10 a las 23:59: ese momento la
              &ldquo;General&rdquo; de la misma sección empieza sola. En butacas numeradas siempre es así (un precio por
              butaca a la vez).
            </p>
          </div>
          <div className="flex basis-full flex-wrap items-end gap-3 rounded-md border border-dashed border-[var(--border)] p-3">
            <p className="basis-full text-sm font-medium">Descuento de preventa (opcional)</p>
            <label className="label">
              Porcentaje (%)
              <input name="discountPercent" inputMode="numeric" placeholder="ej. 20" className="field w-28" />
            </label>
            <label className="label">
              Desde (opcional)
              <input type="datetime-local" name="discountStartsAt" className="field" />
            </label>
            <label className="label">
              Hasta
              <input type="datetime-local" name="discountEndsAt" className="field" />
            </label>
            <p className="basis-full text-xs text-[var(--ink-dim)]">
              Misma entrada, mismo cupo: hasta la fecha se cobra el precio con ese porcentaje menos y después vuelve al
              precio normal solo. La web muestra el precio normal tachado y el descuento.
            </p>
          </div>
        </div>
      </details>
      <button type="submit" className="btn btn-dark">
        Agregar
      </button>
    </ActionForm>
  );
}
