"use client";

import { useId, useState, type ReactNode } from "react";

/** Ayuda en el lugar: un "?" junto a un título que abre una explicación corta. */
export function Help({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Ayuda: ${title}`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] text-[11px] font-bold text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute left-0 top-7 z-20 block w-72 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-[var(--ink)] shadow-lg"
        >
          <span className="mb-1 block text-sm font-semibold">{title}</span>
          {children}
          <button type="button" onClick={() => setOpen(false)} className="mt-2 block text-[var(--accent)] hover:underline">
            Entendido
          </button>
        </span>
      )}
    </span>
  );
}
