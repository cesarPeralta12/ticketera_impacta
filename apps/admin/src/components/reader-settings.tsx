"use client";

import type { ReaderByteOrder } from "@ticketera/core";

/** Cómo entrega el número el lector USB de esta computadora. */
export function ReaderSettings({ order, onChange }: { order: ReaderByteOrder; onChange: (value: ReaderByteOrder) => void }) {
  return (
    <details className="text-sm text-[var(--ink-muted)]">
      <summary className="cursor-pointer">Configurar el lector USB</summary>
      <div className="mt-2 space-y-2">
        <label className="label">
          Orden del número que envía este lector
          <select className="field" value={order} onChange={(e) => onChange(e.target.value as ReaderByteOrder)}>
            <option value="NORMAL">Igual que el teléfono</option>
            <option value="REVERSED">Al revés (invertir)</option>
          </select>
        </label>
        <p>
          Antes de usar un lector nuevo, compara el número de una tarjeta con el que muestra iPass Canje o una app de NFC. Si sale del último al
          primero, elige «Al revés». La puerta solo reconoce la tarjeta si el número coincide.
        </p>
      </div>
    </details>
  );
}
