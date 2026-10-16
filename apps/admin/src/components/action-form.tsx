"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import type { FormState } from "@/lib/forms";
import { useReadOnly } from "./read-only";

/**
 * Formulario del panel conectado a una server action. Muestra el error general y los de
 * cada campo (y marca en rojo el campo y le pone el foco), y solo se limpia cuando la acción
 * salió bien (si se envía con <form action>, React borra los campos también cuando hay error).
 * Si se escribió algo sin guardar, el navegador avisa antes de cerrar o recargar la página.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  successMessage,
  confirm,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
  /** Pide confirmación antes de enviar (acciones destructivas). */
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  // Cuenta de solo lectura: el formulario se ve pero no se puede usar.
  const readOnly = useReadOnly();
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  // El campo con error, en rojo y con el foco: no hay que buscarlo en el formulario.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    for (const el of form.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
    const names = Object.keys(state?.fieldErrors ?? {});
    let first: HTMLElement | null = null;
    for (const name of names) {
      const el = form.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
      if (!el) continue;
      el.setAttribute("aria-invalid", "true");
      first ??= el;
    }
    first?.focus();
  }, [state]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    if (confirm && !window.confirm(confirm)) return;
    const data = new FormData(event.currentTarget);
    setDirty(false);
    startTransition(() => formAction(data));
  }

  const fieldErrors = Object.values(state?.fieldErrors ?? {});
  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      onInput={() => setDirty(true)}
      className={className}
      aria-busy={pending}
      title={readOnly ? "Solo lectura: los cambios los hace Impacta." : undefined}
    >
      <fieldset disabled={pending || readOnly} className="contents">
        {children}
      </fieldset>
      {(state?.error || fieldErrors.length > 0) && !state?.ok && (
        <div role="alert" className="w-full basis-full text-sm text-[var(--danger)]">
          {fieldErrors.length > 0 ? fieldErrors.map((msg) => <p key={msg}>{msg}</p>) : <p>{state?.error}</p>}
        </div>
      )}
      {state?.ok && (state.message ?? successMessage) && (
        <p role="status" className="w-full basis-full text-sm text-[var(--accent)]">
          {state.message ?? successMessage}
        </p>
      )}
    </form>
  );
}
