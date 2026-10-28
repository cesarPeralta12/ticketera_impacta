"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { MAX_TICKETS_PER_ORDER, formatMoney, type MapItem } from "@ticketera/core";
import { SeatPicker, type PickerSection } from "@/components/seat-picker";
import { sellAction, type PosState } from "@/lib/actions/pos";
import { promoterSellAction } from "@/lib/actions/promoters";

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

/**
 * Venta en caja: entradas generales por cantidad, numeradas en el mapa, y el medio de pago. Para un promotor
 * (`promoter`), sin efectivo: con los datos del cliente se abre el cobro por QR y las entradas le llegan al pagar.
 */
export function PosForm({
  sessionId,
  general,
  seated,
  items,
  promoter = false,
  methods = [],
}: {
  sessionId: string;
  general: PosGeneralType[];
  seated: PosSeatedType[];
  /** Plano del boliche (escenario, barras…) para el mapa. */
  items?: MapItem[];
  promoter?: boolean;
  /** Medios de cobro que la cuenta puede usar (vacío: todos). */
  methods?: string[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<PosState, FormData>(promoter ? promoterSellAction : sellAction, {});
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
    // Mesa completa: una silla elige (o suelta) todas las de su mesa.
    if (type.wholeTable) {
      const group = type.seats.find((s) => s.id === seatId)?.group;
      const table = type.seats.filter((s) => s.group === group);
      const name = `${type.wholeTable.prefix} ${group}`;
      if (table.some((s) => current.includes(s.id))) setPicked({ ...seats, [ticketTypeId]: current.filter((id) => !table.some((s) => s.id === id)) });
      else if (table.some((s) => s.taken)) setNotice(`${name} ya tiene sillas vendidas: elige otra mesa.`);
      else if (current.length + table.length > type.maxPerOrder || totalTickets + table.length > MAX_TICKETS_PER_ORDER) {
        setNotice(`Con ${name} (${table.length} sillas) pasas el máximo de entradas por venta: cobra estas y haz otra venta.`);
      } else setPicked({ ...seats, [ticketTypeId]: [...current, ...table.map((s) => s.id)] });
      return;
    }
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
    if (!promoter && !window.confirm(`¿Cobrado ${formatMoney(total, currency)} en ${method}? Se emiten las entradas.`)) return;
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
          <h2 className="eyebrow">{seated.every((t) => t.table) ? "Lounges y mesas" : seated.some((t) => t.table) ? "Butacas y lounges" : "Butacas numeradas"}</h2>
          <SeatPicker sections={seated} selected={selected} onToggle={toggleSeat} items={items} />
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

      {promoter ? (
        <section className="card grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="eyebrow sm:col-span-2">Datos del cliente</h2>
          <label className="label">
            Nombre
            <input name="name" required minLength={3} autoComplete="off" className="field" />
          </label>
          <label className="label">
            Carnet de identidad
            <input name="document" required autoComplete="off" placeholder="1234567 LP" className="field" />
          </label>
          <label className="label">
            Correo (ahí le llegan las entradas)
            <input name="email" type="email" required autoComplete="off" className="field" />
          </label>
          <label className="label">
            WhatsApp (opcional, para mandárselas)
            <input name="phone" type="tel" inputMode="tel" autoComplete="off" placeholder="77123456" className="field" />
          </label>
        </section>
      ) : (
        <>
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
            {METHODS.filter((m) => methods.length === 0 || methods.includes(m.value)).map((m, i) => (
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
        </>
      )}

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
          {promoter ? (pending ? "Generando el cobro…" : "Cobrar con QR") : pending ? "Emitiendo…" : "Cobrar y emitir"}
        </button>
      </div>
    </form>
  );
}
