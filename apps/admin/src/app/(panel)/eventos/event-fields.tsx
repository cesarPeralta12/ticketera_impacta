import { CATEGORY_LABEL } from "@ticketera/core";
import { EventCategory } from "@ticketera/db";
import { MODE_LABEL } from "@/lib/labels";
import { ImageUrlField } from "./image-url-field";

/** Campos del evento (formulario del prototipo), compartidos por "nuevo" y "editar". */
export function EventFields({
  defaults,
  clients,
}: {
  defaults?: {
    title: string;
    description: string | null;
    category: string;
    imageUrl: string | null;
    mode: string;
    clientId: string | null;
    transfersEnabled: boolean;
  };
  /** Clientes de Impacta (null: no aplica, por ejemplo en el panel de un organizador). */
  clients: { id: string; name: string }[] | null;
}) {
  return (
    <>
      <label className="label">
        Título
        <input name="title" required minLength={3} maxLength={120} defaultValue={defaults?.title} className="field" />
      </label>
      <label className="label">
        Descripción
        <textarea name="description" rows={4} maxLength={5000} defaultValue={defaults?.description ?? ""} className="field" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="label">
          Categoría
          <select name="category" defaultValue={defaults?.category ?? "CONCIERTO"} className="field">
            {Object.values(EventCategory).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c] === "Evento" ? "Otro" : CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <ImageUrlField defaultValue={defaults?.imageUrl} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="label">
          Modalidad
          <select name="mode" defaultValue={defaults?.mode ?? "TICKETING"} className="field">
            <option value="TICKETING">{MODE_LABEL.TICKETING}</option>
            <option value="GUEST_LIST">{MODE_LABEL.GUEST_LIST}</option>
          </select>
          <span className="text-xs font-normal text-[var(--ink-dim)]">
            Con lista de invitados no hay venta: se cargan los invitados y cada uno recibe su QR.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="transfersEnabled" defaultChecked={defaults?.transfersEnabled ?? true} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
          <span>
            Permitir que los compradores transfieran sus entradas a otra persona registrada
            <span className="block text-xs font-normal text-[var(--ink-dim)]">
              La entrada recibe un código nuevo y pasa al nombre y carnet de quien la acepta. Máximo 2 transferencias por entrada y hasta 2 horas antes de la función.
            </span>
          </span>
        </label>
        {clients && (
          <label className="label">
            Cliente (Impacta opera el evento)
            <select name="clientId" defaultValue={defaults?.clientId ?? ""} className="field">
              <option value="">IMPACTA (evento propio)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-[var(--ink-dim)]">
              Sus cuentas podrán ver este evento mientras su espacio esté abierto.
            </span>
          </label>
        )}
      </div>
    </>
  );
}
