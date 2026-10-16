"use client";

import { useState, type InputHTMLAttributes } from "react";

/** Campo de contraseña con el botón del ojo para ver lo que se está escribiendo. */
export function PasswordInput({ className = "", style, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "Ocultar contraseña" : "Mostrar contraseña";
  return (
    <span className="relative flex">
      <input {...props} type={visible ? "text" : "password"} className={className} style={{ ...style, width: "100%", paddingRight: "2.5rem" }} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-[var(--ink-dim)] hover:text-[var(--ink)]"
      >
        <EyeIcon off={visible} />
      </button>
    </span>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {off ? (
        <>
          <path d="M10.73 5.08A10.74 10.74 0 0 1 21.94 11.65a1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49" />
          <path d="M14.08 14.16a3 3 0 0 1-4.24-4.24" />
          <path d="M17.48 17.5A10.75 10.75 0 0 1 2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14" />
          <path d="m2 2 20 20" />
        </>
      ) : (
        <>
          <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
