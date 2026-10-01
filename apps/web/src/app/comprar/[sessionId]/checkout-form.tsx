"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { MAX_TICKETS_PER_ORDER, RESERVATION_MINUTES, formatMoney } from "@ticketera/core";
import { createOrderAction, type CheckoutState } from "./actions";
import { SeatPicker, type PickerSection } from "./seat-picker";

export type GeneralType = {
  id: string;
  name: string;
  detail: string | null;
  unitAmount: number;
  currency: string;
  /** Máximo seleccionable: el menor entre disponibles y el límite por compra. */
  max: number;
};

export type SeatedType = PickerSection & { unitAmount: number; currency: string; maxPerOrder: number };

export function CheckoutForm({
  sessionId,
  general,
  seated,
  buyer,
}: {
  sessionId: string;
  general: GeneralType[];
  seated: SeatedType[];
  buyer?: { name: string; email: string };
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<CheckoutState, FormData>(createOrderAction, {});
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // Si alguien tomó una butaca elegida, al refrescarse el mapa deja de contar como elegida.
  const taken = useMemo(
    () => new Set(seated.flatMap((s) => s.seats.filter((seat) => seat.taken).map((seat) => seat.id))),
    [seated],
  );
  const seats = useMemo(
    () => Object.fromEntries(Object.entries(picked).map(([type, ids]) => [type, ids.filter((id) => !taken.has(id))])),
    [picked, taken],
  );

  useEffect(() => {
    if (state.refresh) router.refresh();
  }, [state, router]);

  const seatCount = Object.values(seats).reduce((sum, ids) => sum + ids.length, 0);
  const generalCount = Object.values(quantities).reduce((a, b) => a + b, 0);
  const totalTickets = seatCount + generalCount;
  const total =
    general.reduce((sum, t) => sum + t.unitAmount * (quantities[t.id] ?? 0), 0) +
    seated.reduce((sum, t) => sum + t.unitAmount * (seats[t.ticketTypeId]?.length ?? 0), 0);
  const currency = general[0]?.currency ?? seated[0]?.currency ?? "BOB";
  const selected = new Set(Object.values(seats).flat());

  function toggleSeat(ticketTypeId: string, seatId: string) {
    setNotice(null);
    const type = seated.find((t) => t.ticketTypeId === ticketTypeId)!;
    const current = seats[ticketTypeId] ?? [];
    if (current.includes(seatId)) {
      setPicked({ ...seats, [ticketTypeId]: current.filter((id) => id !== seatId) });
    } else if (current.length >= type.maxPerOrder) {
      setNotice(`Máximo ${type.maxPerOrder} butacas en ${type.name} por compra.`);
    } else if (totalTickets >= MAX_TICKETS_PER_ORDER) {
      setNotice(`Máximo ${MAX_TICKETS_PER_ORDER} entradas por compra.`);
    } else {
      setPicked({ ...seats, [ticketTypeId]: [...current, seatId] });
    }
  }

  // onSubmit (y no <form action>) para que React no borre los campos si hay un error.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="sessionId" value={sessionId} />
      {Object.entries(seats).map(([type, ids]) =>
        ids.length ? <input key={type} type="hidden" name={`seats:${type}`} value={ids.join(",")} /> : null,
      )}

      {seated.length > 0 && (
        <section className="card space-y-4 p-4 sm:p-6">
          <h2 className="font-display text-xl">1. Elige tus butacas</h2>
          <SeatPicker sections={seated} selected={selected} onToggle={toggleSeat} />
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--ink-muted)]">
            {seated.map((t) => (
              <li key={t.ticketTypeId} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                {t.name}: <span className="text-[var(--ink)]">{formatMoney(t.unitAmount, t.currency)}</span>
                {(seats[t.ticketTypeId]?.length ?? 0) > 0 && (
                  <span className="text-[var(--accent)]">× {seats[t.ticketTypeId]!.length}</span>
                )}
              </li>
            ))}
          </ul>
          {notice && <p className="text-sm text-[var(--accent-2)]">{notice}</p>}
        </section>
      )}

      {general.length > 0 && (
        <section className="card">
          <h2 className="border-b border-[var(--border)] px-5 py-4 font-display text-xl">
            {seated.length ? "Entradas generales" : "1. Elige tus entradas"}
          </h2>
          <ul className="divide-y divide-[var(--border)]">
            {general.map((type) => (
              <li key={type.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div>
                  <p className="font-semibold">{type.name}</p>
                  {type.detail && <p className="text-xs text-[var(--ink-dim)]">{type.detail}</p>}
                  <p className="font-display text-lg text-[var(--accent)]">{formatMoney(type.unitAmount, type.currency)}</p>
                </div>
                {type.max === 0 ? (
                  <span className="text-sm text-[var(--ink-dim)]">Agotado</span>
                ) : (
                  <select
                    name={`qty:${type.id}`}
                    aria-label={`Cantidad de ${type.name}`}
                    value={quantities[type.id] ?? 0}
                    onChange={(e) => setQuantities((q) => ({ ...q, [type.id]: Number(e.target.value) }))}
                    className="field w-20"
                  >
                    {Array.from({ length: type.max + 1 }, (_, n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-4 p-5">
        <h2 className="font-display text-xl">2. Tus datos</h2>
        <Field label="Nombre completo" name="name" autoComplete="name" defaultValue={buyer?.name} error={state.fieldErrors?.name} />
        <Field
          label="Email (aquí te enviamos las entradas)"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={buyer?.email}
          error={state.fieldErrors?.email}
        />
        <Field label="Carnet de identidad / NIT (opcional)" name="document" error={state.fieldErrors?.document} />
      </section>

      {state.error && (
        <p role="alert" className="rounded-xl border border-[var(--accent-2)]/40 bg-[var(--accent-2)]/10 px-4 py-3 text-sm">
          {state.error}
        </p>
      )}

      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border-light)] bg-[var(--bg-raised-2)] px-5 py-4 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)]">
        <div>
          <p className="text-sm text-[var(--ink-muted)]">
            {totalTickets} {totalTickets === 1 ? "entrada" : "entradas"} · máximo {MAX_TICKETS_PER_ORDER}
          </p>
          <p className="font-display text-2xl tabular-nums">{formatMoney(total, currency)}</p>
        </div>
        <button type="submit" disabled={pending || totalTickets === 0} className="btn-accent">
          {pending ? "Reservando…" : "Reservar y pagar"}
        </button>
      </div>
      <p className="text-center text-xs text-[var(--ink-dim)]">
        Al continuar, tus entradas quedan reservadas por {RESERVATION_MINUTES} minutos mientras pagas.
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  defaultValue,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  error?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[var(--ink-muted)]">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        className="field mt-1"
      />
      {error && <span className="mt-1 block text-xs text-[var(--accent-2)]">{error}</span>}
    </label>
  );
}
