"use client";

import { useState } from "react";

/** Copia un texto (un enlace, un código) y avisa "Copiado" un momento. */
export function CopyButton({ text, label = "Copiar", className = "btn px-2.5 py-1 text-xs" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copia este texto:", text);
    }
  }
  return (
    <button type="button" onClick={copy} className={className}>
      {copied ? "Copiado ✓" : label}
    </button>
  );
}
