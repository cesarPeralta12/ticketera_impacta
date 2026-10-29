import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CATEGORY_LABEL } from "@ticketera/core";
import { eventLimitMessage, getEventQuota } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { createSmallEventAction } from "@/lib/actions/printed";
import { ROLES, allowedCategories, isNightlife, requireStaff } from "@/lib/session";
import { ImageUrlField } from "../image-url-field";

export const metadata: Metadata = { title: "Evento pequeño" };

const ROWS = [
  { name: "General", placeholder: "ej. 100" },
  { name: "", placeholder: "" },
  { name: "", placeholder: "" },
  { name: "", placeholder: "" },
];

/**
 * Evento pequeño, el acceso rápido (una kermés, una peña, un recital de barrio): en una sola pantalla queda el evento,
 * su función, el lugar sin mapa y sus precios, para vender en la web (sale en «Otros eventos») o con entradas impresas.
 * El asistente de «+ Nuevo evento» sigue siendo el camino completo.
 */
export default async function SmallEventPage() {
  const staff = await requireStaff(ROLES.manage);
  if (staff.readOnly || isNightlife(staff)) redirect("/eventos");
  const quota = staff.platform ? null : await getEventQuota(staff.organization.id);
  const categories = allowedCategories(staff).filter((c) => c !== "BOLICHE");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/eventos" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Eventos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Evento pequeño</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          El acceso rápido para eventos chicos: una sola pantalla con lo justo. Si lo vendes en la web, queda publicado y sale
          en «Otros eventos»; si lo vendes en mano, quedan las entradas numeradas listas para imprimir. Para un evento grande
          (mapa, butacas, fases, varias funciones) usa «+ Nuevo evento».
        </p>
      </div>
      {quota?.reached && (
        <p role="status" className="rounded-xl border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-4 py-3 text-sm text-[var(--warn)]">
          {eventLimitMessage(quota.limit!)}
        </p>
      )}
      <ActionForm action={createSmallEventAction} className="card flex flex-col gap-6 p-6">
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="eyebrow mb-2">1. El evento</legend>
          <label className="label sm:col-span-2">
            Nombre
            <input name="title" required minLength={3} maxLength={120} placeholder="ej. Peña del Club Atlético" className="field" />
          </label>
          <label className="label">
            Categoría
            <select name="category" defaultValue={categories[0]} className="field">
              {categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c] === "Evento" ? "Otro" : CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Fecha
            <input name="date" type="date" required className="field" />
          </label>
          <label className="label">
            Abren puertas (opcional)
            <input name="doors" type="time" className="field" />
          </label>
          <label className="label">
            Empieza
            <input name="start" type="time" required className="field" />
          </label>
          <label className="label">
            Termina (opcional)
            <input name="end" type="time" className="field" />
          </label>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="eyebrow mb-2">2. Dónde</legend>
          <label className="label sm:col-span-2">
            Lugar
            <input name="place" required maxLength={120} placeholder="ej. Salón del Club Atlético" className="field" />
          </label>
          <label className="label">
            Dirección (opcional)
            <input name="address" maxLength={200} placeholder="ej. Av. Busch 1234" className="field" />
          </label>
          <label className="label">
            Ciudad (opcional)
            <input name="city" maxLength={80} placeholder="ej. Santa Cruz" className="field" />
          </label>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="eyebrow mb-2">3. Cómo se vende</legend>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-3 has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
            <input type="radio" name="sale" value="online" defaultChecked className="mt-1 accent-[var(--accent)]" />
            <span className="text-sm">
              <span className="block font-medium">En la web</span>
              <span className="text-[var(--ink-muted)]">Queda publicado y sale en «Otros eventos». También se vende en boletería.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-3 has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
            <input type="radio" name="sale" value="printed" className="mt-1 accent-[var(--accent)]" />
            <span className="text-sm">
              <span className="block font-medium">Entradas impresas</span>
              <span className="text-[var(--ink-muted)]">Para vender en mano: quedan numeradas y listas para imprimir (en borrador).</span>
            </span>
          </label>
          <div className="sm:col-span-2">
            <ImageUrlField label="Foto (opcional, para la web)" placeholder="https://… (pega el enlace de la imagen)" />
          </div>
          <label className="label sm:col-span-2">
            Descripción (opcional)
            <textarea name="description" rows={2} maxLength={2000} placeholder="Qué es, quién toca, qué incluye la entrada…" className="field" />
          </label>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="eyebrow mb-2">4. Entradas</legend>
          <div className="hidden grid-cols-[1fr_8rem_8rem] gap-3 text-xs text-[var(--ink-dim)] sm:grid">
            <span>Tipo</span>
            <span>Precio (Bs)</span>
            <span>Cantidad</span>
          </div>
          {ROWS.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_6rem] gap-3 sm:grid-cols-[1fr_8rem_8rem]">
              <input name={`name${i}`} defaultValue={row.name} maxLength={60} placeholder={i === 0 ? "General" : "ej. VIP (opcional)"} aria-label={`Tipo ${i + 1}`} className="field" />
              <input name={`price${i}`} inputMode="decimal" placeholder={i === 0 ? "ej. 50" : ""} aria-label={`Precio del tipo ${i + 1}`} className="field" />
              <input name={`quantity${i}`} type="number" min={1} max={2000} placeholder={row.placeholder} aria-label={`Cantidad del tipo ${i + 1}`} className="field" />
            </div>
          ))}
          <p className="text-xs text-[var(--ink-dim)]">Deja vacías las filas que no uses. Precio 0 = entrada de cortesía. Impresas: hasta 2000 por tipo.</p>
          <label className="label">
            Validez (solo para impresas)
            <select name="mode" defaultValue="ACTIVATE_ON_SALE" className="field">
              <option value="ACTIVATE_ON_SALE">Activadas al vender (recomendado)</option>
              <option value="VALID_ON_PRINT">Válidas al imprimir</option>
            </select>
          </label>
          <p className="text-xs text-[var(--ink-dim)]">
            <strong>Activadas al vender</strong>: en la puerta no pasan hasta que las marcas vendidas (una fotocopia o una robada
            no entra). <strong>Válidas al imprimir</strong>: pasan desde que se imprimen.
          </p>
        </fieldset>

        <button type="submit" disabled={quota?.reached} className="btn btn-primary w-fit disabled:cursor-not-allowed disabled:opacity-50">
          Crear el evento
        </button>
      </ActionForm>
    </div>
  );
}
