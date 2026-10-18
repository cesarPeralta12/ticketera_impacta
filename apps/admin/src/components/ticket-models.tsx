"use client";

import { useRef, useState } from "react";
import { TICKET_MODELS, type TicketModel } from "@ticketera/core";

/**
 * Botones de modelo (General, VIP, Mesa, Free, Preventa) arriba del formulario de precios: llenan los campos con lo
 * típico de cada uno y abren las opciones que hacen falta. Los campos siguen siendo del formulario: se pueden cambiar.
 */
export function TicketModels({ presaleEnd }: { presaleEnd: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<TicketModel | null>(null);

  function apply(model: TicketModel) {
    const form = ref.current?.closest("form");
    if (!form) return;
    const field = (name: string) => form.querySelector<HTMLInputElement>(`[name="${name}"]`);
    const set = (name: string, value: string) => {
      const el = field(name);
      if (el) el.value = value;
    };
    const check = (name: string, on: boolean) => {
      const el = field(name);
      if (el) el.checked = on;
    };
    set("name", model.name);
    set("price", model.price ?? "");
    set("maxPerOrder", String(model.maxPerOrder));
    check("table", Boolean(model.table));
    set("peoplePerUnit", model.table ? String(model.table.peoplePerUnit) : "");
    set("entryUntil", model.entryUntil ?? "");
    check("presale", Boolean(model.presale));
    check("exclusive", true);
    set("salesEndAt", model.presale ? (presaleEnd ?? "") : "");
    if (model.table || model.entryUntil) form.querySelector<HTMLDetailsElement>('details[data-section="club"]')?.setAttribute("open", "");
    if (model.presale) form.querySelector<HTMLDetailsElement>('details[data-section="more"]')?.setAttribute("open", "");
    setPicked(model);
    (model.price === undefined ? field("price") : field("capacity"))?.focus();
  }

  return (
    <div ref={ref} className="basis-full space-y-2">
      <p className="text-sm font-medium">Empezar desde un modelo</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Modelos de tipo de entrada">
        {TICKET_MODELS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => apply(m)}
            aria-pressed={picked?.key === m.key}
            className={`btn text-xs ${picked?.key === m.key ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : ""}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--ink-dim)]">{picked ? picked.hint : "Elige uno y completa lo que falte (precio, cupo). Todo se puede cambiar."}</p>
    </div>
  );
}
