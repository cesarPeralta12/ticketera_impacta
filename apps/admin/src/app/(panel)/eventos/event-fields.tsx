import { CATEGORY_LABEL } from "@ticketera/core";
import { EventCategory } from "@ticketera/db";

/** Campos del evento (formulario del prototipo), compartidos por "nuevo" y "editar". */
export function EventFields({
  defaults,
}: {
  defaults?: { title: string; description: string | null; category: string; imageUrl: string | null };
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
        <label className="label">
          Imagen (URL)
          <input name="imageUrl" type="url" placeholder="https://…" defaultValue={defaults?.imageUrl ?? ""} className="field" />
        </label>
      </div>
    </>
  );
}
