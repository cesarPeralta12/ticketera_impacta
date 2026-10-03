"use client";

export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-primary print:hidden">
      {label}
    </button>
  );
}
