"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { MAX_TICKETS_PER_ORDER, RESERVATION_MINUTES, formatMoney } from "@ticketera/core";
import { createOrderAction, type CheckoutState } from "./actions";
import { SeatPicker, type PickerSection } from "./seat-picker";

export type GeneralType = {
  id: string;
  name: string;
  detail: string | null;
  /** Precio que se cobra ahora (con el descuento de preventa vigente, si hay). */
  unitAmount: number;
  /** Precio normal tachado, solo si hay descuento vigente. */
  listAmount: number | null;
  /** Ej. "20% menos hasta 20 oct, 23:59". */
  discountLabel: string | null;
  currency: string;
  /** Máximo seleccionable: el menor entre disponibles y el límite por compra. */
  max: number;
  /** Preventa: hasta cuándo se vende (texto ya formateado). */
  presaleUntil: string | null;
  /** Todavía no empieza: desde cuándo se vende (texto ya formateado). */
  opensAt: string | null;
};

export type SeatedType = PickerSection & { maxPerOrder: number };

export function CheckoutForm({
  sessionId,
  general,
  seated,
  buyer,
}: {
  sessionId: string;
  general: GeneralType[];
  seated: SeatedType[];
  buyer: { name: string; email: string; document: string };
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
                {t.name}
                {t.presale && <span className="font-semibold text-[var(--accent-2)]">(preventa)</span>}
                {t.discountPercent ? <span className="font-semibold text-[var(--accent-2)]"> (-{t.discountPercent}% preventa)</span> : null}:{" "}
                <span className="text-[var(--ink)]">{formatMoney(t.unitAmount, t.currency)}</span>
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
                  <p className="font-semibold">
                    {type.name}
                    {type.presaleUntil && (
                      <span className="ml-2 rounded-full bg-[var(--accent-2)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent-2)]">
                        Preventa
                      </span>
                    )}
                  </p>
                  {type.detail && <p className="text-xs text-[var(--ink-dim)]">{type.detail}</p>}
                  {type.presaleUntil && <p className="text-xs text-[var(--accent-2)]">Hasta {type.presaleUntil}</p>}
                  <p className="font-display text-lg text-[var(--accent)]">
                    {type.listAmount !== null && (
                      <span className="mr-2 text-sm text-[var(--ink-dim)] line-through">{formatMoney(type.listAmount, type.currency)}</span>
                    )}
                    {formatMoney(type.unitAmount, type.currency)}
                  </p>
                  {type.discountLabel && <p className="text-xs font-semibold text-[var(--accent-2)]">Preventa: {type.discountLabel}</p>}
                </div>
                {type.opensAt ? (
                  <span className="text-right text-sm text-[var(--ink-dim)]">
                    A la venta
                    <br />
                    desde {type.opensAt}
                  </span>
                ) : type.max === 0 ? (
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

      <section className="card space-y-3 p-5">
        <h2 className="font-display text-xl">2. Comprando como</h2>
        <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-sm">
          <dt className="text-[var(--ink-muted)]">Nombre</dt>
          <dd className="font-semibold">{buyer.name}</dd>
          <dt className="text-[var(--ink-muted)]">Email</dt>
          <dd>{buyer.email}</dd>
          <dt className="text-[var(--ink-muted)]">Carnet</dt>
          <dd className="font-mono">{buyer.document}</dd>
        </dl>
        <p className="text-xs text-[var(--ink-dim)]">
          Las entradas salen a tu nombre y con tu carnet, que se verifica en la puerta.{" "}
          <Link href={`/cuenta/datos?next=${encodeURIComponent(`/comprar/${sessionId}`)}`} className="text-[var(--accent)] underline underline-offset-4">
            Editar mis datos
          </Link>
        </p>
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
