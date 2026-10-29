import { CATEGORY_LABEL, DEFAULT_REFUND_POLICY, MIN_AGE_OPTIONS } from "@ticketera/core";
import { EventCategory } from "@ticketera/db";
import { MODE_LABEL } from "@/lib/labels";
import { ImageUrlField } from "./image-url-field";

/** Campos del evento (formulario del prototipo), compartidos por "nuevo" y "editar". */
export function EventFields({
  defaults,
  clients,
  categories = Object.values(EventCategory),
}: {
  defaults?: {
    title: string;
    description: string | null;
    category: string;
    imageUrl: string | null;
    mode: string;
    clientId: string | null;
    transfersEnabled: boolean;
    small?: boolean;
    minAge?: number | null;
    requiredDocument?: string | null;
    dressCode?: string | null;
    forbiddenItems?: string | null;
    reentryPolicy?: string | null;
    refundPolicy?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
  };
  /** Clientes de Impacta (null: no aplica, por ejemplo en el panel de un organizador). */
  clients: { id: string; name: string }[] | null;
  /** Categorías que admite el organizador (un boliche, solo "Boliche"). */
  categories?: EventCategory[];
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
          <select name="category" defaultValue={defaults?.category ?? categories[0]} className="field">
            {categories.map((c) => (
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
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="small" defaultChecked={defaults?.small ?? false} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
          <span>
            Evento pequeño
            <span className="block text-xs font-normal text-[var(--ink-dim)]">
              Peñas, recitales íntimos, obras o fiestas con pocos cupos: además de la portada, aparece en «Otros eventos» de la web.
            </span>
          </span>
        </label>
        {clients && (
          <label className="label">
            Cliente (iPass opera el evento)
            <select name="clientId" defaultValue={defaults?.clientId ?? ""} className="field">
              <option value="">iPass (evento propio)</option>
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
      <details
        className="rounded-md border border-[var(--border)] p-4"
        open={Boolean(defaults && (defaults.minAge || defaults.requiredDocument || defaults.dressCode || defaults.refundPolicy || defaults.contactPhone))}
      >
        <summary className="cursor-pointer text-sm font-medium">
          Condiciones y contacto <span className="font-normal text-[var(--ink-dim)]">· lo ve el comprador antes de comprar y en su entrada</span>
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="label">
            Edad mínima
            <select name="minAge" defaultValue={defaults?.minAge ? String(defaults.minAge) : ""} className="field">
              <option value="">Todo público</option>
              {MIN_AGE_OPTIONS.map((age) => (
                <option key={age} value={age}>
                  Mayores de {age}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Documento para entrar
            <input name="requiredDocument" maxLength={120} defaultValue={defaults?.requiredDocument ?? ""} placeholder="Carnet de identidad" className="field" />
          </label>
          <label className="label">
            Código de vestimenta
            <input name="dressCode" maxLength={200} defaultValue={defaults?.dressCode ?? ""} placeholder="Elegante sport" className="field" />
          </label>
          <label className="label">
            Objetos no permitidos
            <input name="forbiddenItems" maxLength={300} defaultValue={defaults?.forbiddenItems ?? ""} placeholder="Bebidas, armas, cámaras profesionales" className="field" />
          </label>
          <label className="label sm:col-span-2">
            Reingreso (¿se puede salir y volver?)
            <input name="reentryPolicy" maxLength={300} defaultValue={defaults?.reentryPolicy ?? ""} placeholder="No se permite reingreso sin pulsera." className="field" />
          </label>
          <label className="label sm:col-span-2">
            Cambios y reembolsos
            <textarea name="refundPolicy" rows={3} maxLength={2000} defaultValue={defaults?.refundPolicy ?? DEFAULT_REFUND_POLICY} className="field" />
            <span className="text-xs font-normal text-[var(--ink-dim)]">Viene un texto estándar: edítalo o bórralo.</span>
          </label>
          <label className="label">
            WhatsApp o teléfono de consultas
            <input name="contactPhone" type="tel" maxLength={40} defaultValue={defaults?.contactPhone ?? ""} placeholder="71234567" className="field" />
          </label>
          <label className="label">
            Correo de consultas
            <input name="contactEmail" type="email" maxLength={120} defaultValue={defaults?.contactEmail ?? ""} className="field" />
          </label>
        </div>
      </details>
    </>
  );
}
