"use client";

import { useState } from "react";

/**
 * La página del evento tal como la ve el comprador, en computadora y en celular, dentro del panel. Si la web no deja
 * mostrarse aquí (falta ADMIN_URL en su configuración), queda el enlace para abrirla en otra pestaña.
 */
export function BuyerPreview({ url }: { url: string }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("mobile");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-[var(--border)] p-0.5 text-xs" role="group" aria-label="Dispositivo">
          {(["mobile", "desktop"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
              className={`rounded px-3 py-1 ${device === d ? "bg-[var(--accent)] text-white" : "text-[var(--ink-muted)]"}`}
            >
              {d === "mobile" ? "Celular" : "Computadora"}
            </button>
          ))}
        </div>
        <a href={url} target="_blank" rel="noreferrer" className="text-sm text-[var(--accent)] hover:underline">
          Abrir en otra pestaña ↗
        </a>
      </div>
      <div className={`overflow-hidden rounded-xl border border-[var(--border)] bg-[#111a2b] ${device === "mobile" ? "mx-auto w-[390px] max-w-full" : "w-full"}`}>
        <iframe
          key={device}
          src={url}
          title={`Vista previa en ${device === "mobile" ? "celular" : "computadora"}`}
          className="block w-full border-0"
          style={{ height: device === "mobile" ? 760 : 680 }}
        />
      </div>
    </div>
  );
}
