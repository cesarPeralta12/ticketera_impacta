"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { MAX_TICKETS_PER_ORDER, formatMoney } from "@ticketera/core";
import { SeatPicker, type PickerSection } from "@/components/seat-picker";
import { sellAction, type PosState } from "@/lib/actions/pos";

export type PosGeneralType = {
  id: string;
  name: string;
  detail: string | null;
  /** Precio que se cobra ahora (con el descuento de preventa vigente, si hay). */
  unitAmount: number;
  listAmount: number | null;
  discountLabel: string | null;
  currency: string;
  max: number;
};
export type PosSeatedType = PickerSection & { maxPerOrder: number };

const METHODS = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "QR", label: "QR" },
  { value: "TARJETA", label: "Tarjeta" },
] as const;

/** Venta en caja: entradas generales por cantidad, numeradas en el mapa, y el medio de pago. */
export function PosForm({
  sessionId,
  general,
  seated,
}: {
  sessionId: string;
  general: PosGeneralType[];
  seated: PosSeatedType[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<PosState, FormData>(sellAction, {});
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState<string | null>(null);

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
  const totalTickets = seatCount + Object.values(quantities).reduce((a, b) => a + b, 0);
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
      setNotice(`Máximo ${type.maxPerOrder} butacas de ${type.name} por venta.`);
    } else if (totalTickets >= MAX_TICKETS_PER_ORDER) {
      setNotice(`Máximo ${MAX_TICKETS_PER_ORDER} entradas por venta: cobra estas y haz otra venta.`);
    } else {
      setPicked({ ...seats, [ticketTypeId]: [...current, seatId] });
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const method = METHODS.find((m) => m.value === data.get("method"))?.label ?? "";
    if (!window.confirm(`¿Cobrado ${formatMoney(total, currency)} en ${method}? Se emiten las entradas.`)) return;
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="sessionId" value={sessionId} />
      {Object.entries(seats).map(([type, ids]) =>
        ids.length ? <input key={type} type="hidden" name={`seats:${type}`} value={ids.join(",")} /> : null,
      )}

      {general.length > 0 && (
        <section className="card">
          <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">Entradas generales</h2>
          <ul className="divide-y divide-[var(--border)]">
            {general.map((type) => (
              <li key={type.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div>
                  <p className="font-medium">{type.name}</p>
                  {type.detail && <p className="text-xs text-[var(--ink-dim)]">{type.detail}</p>}
                  <p className="font-mono text-sm text-[var(--accent)]">
                    {type.listAmount !== null && (
                      <span className="mr-2 text-xs text-[var(--ink-dim)] line-through">{formatMoney(type.listAmount, type.currency)}</span>
                    )}
                    {formatMoney(type.unitAmount, type.currency)}
                  </p>
                  {type.discountLabel && <p className="text-xs font-semibold text-[var(--warn)]">Preventa: {type.discountLabel}</p>}
                </div>
                {type.max === 0 ? (
                  <span className="badge bg-[var(--surface-2)] text-[var(--ink-dim)]">Agotado</span>
                ) : (
                  <select
                    name={`qty:${type.id}`}
                    aria-label={`Cantidad de ${type.name}`}
                    value={quantities[type.id] ?? 0}
                    onChange={(e) => setQuantities((q) => ({ ...q, [type.id]: Number(e.target.value) }))}
                    className="field w-20 text-base"
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

      {seated.length > 0 && (
        <section className="card space-y-3 p-4">
          <h2 className="eyebrow">Butacas numeradas</h2>
          <SeatPicker sections={seated} selected={selected} onToggle={toggleSeat} />
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--ink-muted)]">
            {seated.map((t) => (
              <li key={t.ticketTypeId} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                {t.name}: <span className="font-mono text-[var(--ink)]">{formatMoney(t.unitAmount, t.currency)}</span>
                {(seats[t.ticketTypeId]?.length ?? 0) > 0 && (
                  <span className="text-[var(--accent)]">× {seats[t.ticketTypeId]!.length}</span>
                )}
              </li>
            ))}
          </ul>
          {notice && <p className="text-sm text-[var(--warn)]">{notice}</p>}
        </section>
      )}

      <section className="card grid gap-4 p-5 sm:grid-cols-4">
        <label className="label">
          Nombre (opcional)
          <input name="name" autoComplete="off" className="field" />
        </label>
        <label className="label">
          Email (opcional)
          <input name="email" type="email" autoComplete="off" className="field" />
        </label>
        <label className="label">
          Código promocional (opcional)
          <input name="promo" autoComplete="off" placeholder="RRPP-XXXXX" className="field font-mono uppercase" />
        </label>
        <label className="label">
          Carnet de identidad (obligatorio)
          <input name="document" required autoComplete="off" placeholder="1234567 LP" className="field" />
        </label>
      </section>

      <fieldset className="card flex flex-wrap items-center gap-3 p-5">
        <legend className="sr-only">Medio de pago</legend>
        <span className="eyebrow mr-2">Cobro</span>
        {METHODS.map((m, i) => (
          <label
            key={m.value}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] px-4 py-2 text-sm has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]"
          >
            <input type="radio" name="method" value={m.value} defaultChecked={i === 0} className="accent-[var(--accent)]" />
            {m.label}
          </label>
        ))}
        <span className="text-xs text-[var(--ink-dim)]">Se registra lo que declares: no se conecta con el banco.</span>
      </fieldset>

      {state.error && (
        <p role="alert" className="rounded-md bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      )}

      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4 shadow-lg">
        <div>
          <p className="text-sm text-[var(--ink-muted)]">
            {totalTickets} {totalTickets === 1 ? "entrada" : "entradas"} · máximo {MAX_TICKETS_PER_ORDER} por venta
          </p>
          <p className="font-mono text-2xl">{formatMoney(total, currency)}</p>
        </div>
        <button type="submit" disabled={pending || totalTickets === 0} className="btn btn-primary px-6 py-3 text-base">
          {pending ? "Emitiendo…" : "Cobrar y emitir"}
        </button>
      </div>
    </form>
  );
}
