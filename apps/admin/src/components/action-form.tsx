"use client";

import { useActionState, useEffect, useRef, useTransition, type FormEvent, type ReactNode } from "react";
import type { FormState } from "@/lib/forms";

/**
 * Formulario del panel conectado a una server action. Muestra el error general y los de
 * cada campo, y solo se limpia cuando la acción salió bien (si se envía con <form action>,
 * React borra los campos también cuando hay error).
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
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  const fieldErrors = Object.values(state?.fieldErrors ?? {});
  return (
    <form ref={formRef} onSubmit={onSubmit} className={className} aria-busy={pending}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {(state?.error || fieldErrors.length > 0) && !state?.ok && (
        <div role="alert" className="w-full basis-full text-sm text-[var(--danger)]">
          {fieldErrors.length > 0 ? fieldErrors.map((msg) => <p key={msg}>{msg}</p>) : <p>{state?.error}</p>}
        </div>
      )}
      {state?.ok && successMessage && (
        <p role="status" className="w-full basis-full text-sm text-[var(--accent)]">
          {successMessage}
        </p>
      )}
    </form>
  );
}
