"use client";

import { useState } from "react";
import { normalizeImageUrl } from "@ticketera/core";

/** Campo de imagen con vista previa: así se nota al instante si la URL no es una foto. */
export function ImageUrlField({ defaultValue }: { defaultValue?: string | null }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = value.trim() ? normalizeImageUrl(value) : "";
  const fixed = src && src !== value.trim();

  return (
    <div className="label">
      <label htmlFor="imageUrl">Imagen (URL)</label>
      <input
        id="imageUrl"
        name="imageUrl"
        type="url"
        placeholder="https://… (clic derecho sobre la foto → Copiar dirección de imagen)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="field"
      />
      {src && (
        <div className="mt-1 flex items-start gap-3">
          {failedSrc === src ? (
            <p className="text-xs text-[var(--danger)]">
              Esta dirección no muestra una imagen. En Google, abre la foto, haz clic derecho sobre ella y elige
              «Copiar dirección de imagen».
            </p>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- vista previa de una URL arbitraria */}
              <img
                src={src}
                alt="Vista previa"
                onError={() => setFailedSrc(src)}
                className="h-20 w-32 rounded-md border border-[var(--border)] object-cover"
              />
              {fixed && (
                <p className="text-xs text-[var(--accent)]">
                  Pegaste el enlace de una página de búsqueda: se guardará la imagen real.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
