"use client";

import { useRef, type ReactNode } from "react";

/**
 * Botón que abre una ventana emergente con su contenido (un formulario, por ejemplo). Usa el <dialog> del navegador:
 * se cierra con Esc, con la X o tocando fuera, y el contenido de atrás no se puede tocar mientras está abierta.
 */
export function ModalButton({
  label,
  title,
  description,
  primary = false,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  primary?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={`btn ${primary ? "btn-primary" : ""}`}>
        {label}
      </button>
      <dialog
        ref={ref}
        // Tocar fuera de la tarjeta (el fondo del <dialog>) cierra.
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[min(44rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--ink)] shadow-2xl backdrop:bg-black/50"
      >
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              {description && <p className="mt-1 text-sm text-[var(--ink-muted)]">{description}</p>}
            </div>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Cerrar" className="rounded-md px-2 py-1 text-xl leading-none text-[var(--ink-dim)] hover:text-[var(--ink)]">
              ×
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
