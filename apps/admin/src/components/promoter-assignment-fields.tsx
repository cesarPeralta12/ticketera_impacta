import { DEFAULT_TIMEZONE, utcToZonedInput } from "@ticketera/core";
import { EventSessionsPicker, type PickerEvent } from "@/components/event-sessions-picker";

/**
 * Los campos de un evento del promotor (para el alta y para asignar o cambiar): evento y funciones, comisión (% o Bs
 * por entrada), cupo y vigencia. Van dentro de un ActionForm.
 */
export function PromoterAssignmentFields({
  events,
  current,
}: {
  events: PickerEvent[];
  current?: {
    eventId: string;
    sessionIds: string[];
    commissionType: "PERCENT" | "FIXED";
    commissionValue: number;
    quota: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
  };
}) {
  const value = current ? (current.commissionType === "FIXED" ? (current.commissionValue / 100).toString().replace(".", ",") : String(current.commissionValue)) : "";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <EventSessionsPicker events={events} defaultEventId={current?.eventId} defaultSessionIds={current?.sessionIds} />
      <label className="label">
        Comisión
        <select name="commissionType" defaultValue={current?.commissionType ?? "PERCENT"} className="field">
          <option value="PERCENT">% de cada venta</option>
          <option value="FIXED">Bs por entrada</option>
        </select>
      </label>
      <label className="label">
        Valor
        <input name="commissionValue" required inputMode="decimal" defaultValue={value} placeholder="ej. 10" className="field w-24" />
      </label>
      <label className="label">
        Cupo (opcional)
        <input name="quota" type="number" min={1} defaultValue={current?.quota ?? ""} placeholder="sin tope" className="field w-28" />
      </label>
      <label className="label">
        Vende desde (opcional)
        <input type="datetime-local" name="startsAt" defaultValue={current?.startsAt ? utcToZonedInput(current.startsAt, DEFAULT_TIMEZONE) : ""} className="field" />
      </label>
      <label className="label">
        Hasta (opcional)
        <input type="datetime-local" name="endsAt" defaultValue={current?.endsAt ? utcToZonedInput(current.endsAt, DEFAULT_TIMEZONE) : ""} className="field" />
      </label>
    </div>
  );
}
