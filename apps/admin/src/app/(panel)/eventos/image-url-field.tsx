"use client";

import { useRef, useState } from "react";
import { EVENT_IMAGE_MAX_BYTES, EVENT_IMAGE_MAX_SIDE, normalizeImageUrl } from "@ticketera/core";
import { useReadOnly } from "@/components/read-only";
import { uploadEventImageAction } from "@/lib/actions/event-images";

/**
 * Achica la foto en el navegador (lado mayor EVENT_IMAGE_MAX_SIDE) y la pasa a JPG: entra bajo el tope del servidor
 * aunque venga directo de la cámara, y pierde los datos ocultos del archivo (como la ubicación donde se sacó).
 */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, EVENT_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  // JPG no tiene transparencia: lo transparente de un PNG queda blanco (no negro).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.72, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= EVENT_IMAGE_MAX_BYTES) return blob;
  }
  throw new Error("La foto sigue siendo muy pesada.");
}

/**
 * Campo de imagen con vista previa: se pega el enlace de una foto o se sube un archivo (queda guardado en iPass y el
 * campo toma su dirección). Así se nota al instante si la URL no es una foto.
 */
export function ImageUrlField({
  defaultValue,
  label = "Imagen",
  placeholder = "https://… (clic derecho sobre la foto → Copiar dirección de imagen)",
}: {
  defaultValue?: string | null;
  label?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const readOnly = useReadOnly();
  const src = value.trim() ? normalizeImageUrl(value) : "";
  const fixed = src && src !== value.trim();

  async function upload(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("image", await shrinkImage(file), "foto.jpg");
      const result = await uploadEventImageAction(fd);
      if ("error" in result) setUploadError(result.error);
      else setValue(result.url);
    } catch {
      setUploadError("No se pudo leer esa foto: prueba con un JPG o PNG.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="label">
      <label htmlFor="imageUrl">{label}</label>
      <div className="flex gap-2">
        <input
          id="imageUrl"
          name="imageUrl"
          type="url"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="field min-w-0 flex-1"
        />
        {/* Sin `name`: el archivo no viaja con el formulario del evento, se sube aparte y queda su dirección arriba. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || readOnly}
          className="btn shrink-0 whitespace-nowrap text-sm disabled:opacity-50"
        >
          {uploading ? "Subiendo…" : "Subir archivo"}
        </button>
      </div>
      <p className="text-xs text-[var(--ink-dim)]">Pega el enlace de una foto o sube una desde tu computadora o celular (JPG, PNG o WebP).</p>
      {uploadError && <p className="text-xs text-[var(--danger)]">{uploadError}</p>}
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
