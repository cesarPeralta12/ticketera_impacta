"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PROMO_ASSET_ACCEPT_MESSAGE, PROMO_ASSET_MAX_BYTES, PROMO_ASSET_RETENTION_DAYS, formatBytes } from "@ticketera/core";
import { ActionForm } from "@/components/action-form";
import { useReadOnly } from "@/components/read-only";
import { deletePromoAssetAction } from "@/lib/actions/promo-assets";

export type PromoAssetRow = { id: string; fileName: string; byteSize: number; width: number | null; height: number | null; hasThumb: boolean };

/** Miniatura y medidas de una imagen, solo para la vista previa. El archivo que se sube es el original. */
async function previewOf(file: File): Promise<{ thumb: Blob | null; width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) return { thumb: null };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    const thumb = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
    return { thumb, ...out };
  } catch {
    return { thumb: null };
  }
}

/** Sube y lista el material promocional del evento: los promotores con el evento asignado lo descargan en su calidad original. */
export function PromoAssetsManager({ eventId, assets }: { eventId: string; assets: PromoAssetRow[] }) {
  const router = useRouter();
  const readOnly = useReadOnly();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > PROMO_ASSET_MAX_BYTES) return setError(`Pesa ${formatBytes(file.size)}: el máximo es ${formatBytes(PROMO_ASSET_MAX_BYTES)}.`);
    if (!/^(image|video)\//.test(file.type)) return setError(PROMO_ASSET_ACCEPT_MESSAGE);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file, file.name);
      const { thumb, width, height } = await previewOf(file);
      if (thumb) fd.set("thumb", thumb, "miniatura.jpg");
      if (width && height) {
        fd.set("width", String(width));
        fd.set("height", String(height));
      }
      const res = await fetch(`/api/material/${eventId}`, { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(body.error ?? "No se pudo subir el archivo.");
      else router.refresh();
    } catch {
      setError("No se pudo subir el archivo: revisa tu conexión.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--ink-muted)]">
        Sube la imagen o el video que los promotores van a descargar desde su panel. Es un solo archivo por evento: si subes otro, reemplaza al anterior. Se guarda <strong>tal cual lo subes</strong>, sin
        comprimirlo, para que se mantenga la calidad. Máximo {formatBytes(PROMO_ASSET_MAX_BYTES)}.
      </p>
      <p className="rounded-md border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">
        Aviso: estos archivos se eliminan automáticamente {PROMO_ASSET_RETENTION_DAYS} días después de la última función del evento. Guarda una copia
        si la necesitas después.
      </p>

      {assets.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
          {assets.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              {a.hasThumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/promotor/material/${a.id}?miniatura=1`} alt="" className="h-12 w-12 rounded object-cover" />
              ) : (
                <span className="grid h-12 w-12 place-items-center rounded bg-[var(--surface-2)] text-xs text-[var(--ink-dim)]">Video</span>
              )}
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate font-medium">{a.fileName}</span>
                <span className="text-xs text-[var(--ink-dim)]">
                  {formatBytes(a.byteSize)}
                  {a.width && a.height ? ` · ${a.width}×${a.height} px` : ""}
                </span>
              </span>
              <a href={`/promotor/material/${a.id}`} className="btn px-3 py-1.5 text-xs">
                Descargar
              </a>
              <ActionForm action={deletePromoAssetAction} confirm="¿Borrar este archivo? Los promotores dejarán de verlo.">
                <input type="hidden" name="assetId" value={a.id} />
                <button type="submit" className="btn px-3 py-1.5 text-xs">
                  Borrar
                </button>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept="image/*,video/*" disabled={readOnly || busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="text-sm" />
        {busy && <span className="text-sm text-[var(--ink-dim)]">Subiendo…</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
