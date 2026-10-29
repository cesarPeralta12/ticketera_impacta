"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { MAX_TICKETS_PER_ORDER, RESERVATION_MINUTES, bestAvailableSeats, formatMoney, orphanSeats, type MapItem, type PickSeat } from "@ticketera/core";
import { createOrderAction, previewPromoAction, type CheckoutState, type PromoPreview } from "./actions";
import { SeatPicker, type PickerSection, type PickerZone } from "./seat-picker";

export type GeneralType = {
  id: string;
  /** Zona (sección) a la que pertenece: las entradas de una misma zona comparten aforo y se resaltan juntas. */
  sectionId: string | null;
  name: string;
  detail: string | null;
  /** Precio que se cobra ahora (con el descuento de preventa vigente, si hay). */
  unitAmount: number;
  /** Precio normal tachado, solo si hay descuento vigente. */
  listAmount: number | null;
  /** Ej. "20% menos hasta 20 oct, 23:59". */
  discountLabel: string | null;
  currency: string;
  /** Lugares que quedan de esta entrada (considerando el aforo compartido de la zona). */
  left: number;
  /** Máximo seleccionable: el menor entre disponibles y el límite por compra. */
  max: number;
  /** Preventa: hasta cuándo se vende (texto ya formateado). */
  presaleUntil: string | null;
  /** "Fase 2 de 4" si es una fase de venta (la que se vende ahora). */
  phase: string | null;
  /** "Incluye: Zona VIP" si la entrada abre zonas propias. */
  includes: string | null;
  /** Todavía no empieza: desde cuándo se vende (texto ya formateado). */
  opensAt: string | null;
  /** Boliche: mesa o lounge (el cupo y la cantidad son mesas; cada persona recibe su QR). */
  table: { people: number } | null;
  /** Consumo incluido en barra (texto ya formateado), por mesa o por entrada. */
  consumption: string | null;
  /** Válida para entrar solo hasta esta hora ("01:00"). */
  entryUntil: string | null;
};

export type SeatedType = PickerSection & {
  maxPerOrder: number;
  /** Boliche: cada butaca de la sección es una mesa para estas personas (cada una recibe su QR). */
  table?: { people: number } | null;
  /** Consumo incluido por mesa (texto ya formateado). */
  consumption?: string | null;
  /** "Incluye: Zona VIP" si abre zonas propias. */
  includes?: string | null;
};

export function CheckoutForm({
  sessionId,
  general,
  seated,
  zones = [],
  items = [],
  buyer,
  holdCode,
  linkPromo,
}: {
  sessionId: string;
  general: GeneralType[];
  seated: SeatedType[];
  /** Zonas generales dibujadas en el mapa. */
  zones?: PickerZone[];
  /** Plano del boliche (escenario, barras…). */
  items?: MapItem[];
  buyer: { name: string; email: string; document: string };
  /** Código de una retención (del enlace): habilita sus butacas apartadas. */
  holdCode?: string;
  /** Código del enlace de un promotor: se aplica solo al elegir las entradas (si no aplica aquí, no se muestra nada). */
  linkPromo?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<CheckoutState, FormData>(createOrderAction, {});
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState(linkPromo ?? "");
  const [promo, setPromo] = useState<Extract<PromoPreview, { ok: true }> | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // Entradas elegidas por zona (para marcarlas en el mapa) y salto del mapa a su selector de la lista.
  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of general) if (t.sectionId) counts[t.sectionId] = (counts[t.sectionId] ?? 0) + (quantities[t.id] ?? 0);
    return counts;
  }, [general, quantities]);

  function goToZone(sectionId: string) {
    document.getElementById(`zona-${sectionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(sectionId);
    setTimeout(() => setFlash((f) => (f === sectionId ? null : f)), 1800);
  }

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
  // Una mesa de 6 son 6 QR (uno por persona).
  const tableQrs =
    general.reduce((sum, t) => sum + (t.table ? t.table.people * (quantities[t.id] ?? 0) : 0), 0) +
    seated.reduce((sum, t) => sum + (t.table ? t.table.people * (seats[t.ticketTypeId]?.length ?? 0) : 0), 0);
  const total =
    general.reduce((sum, t) => sum + t.unitAmount * (quantities[t.id] ?? 0), 0) +
    seated.reduce((sum, t) => sum + t.unitAmount * (seats[t.ticketTypeId]?.length ?? 0), 0);
  const currency = general[0]?.currency ?? seated[0]?.currency ?? "BOB";

  // Lo elegido, para calcular el descuento de un código (una línea por tipo de entrada).
  const chosen = useMemo(
    () => [
      ...general.flatMap((t) => ((quantities[t.id] ?? 0) > 0 ? [{ ticketTypeId: t.id, quantity: quantities[t.id]! }] : [])),
      ...seated.flatMap((t) => ((seats[t.ticketTypeId]?.length ?? 0) > 0 ? [{ ticketTypeId: t.ticketTypeId, quantity: seats[t.ticketTypeId]!.length }] : [])),
    ],
    [general, seated, quantities, seats],
  );
  const chosenKey = JSON.stringify(chosen);

  async function applyPromo(code: string) {
    if (!code.trim()) return;
    setPromoBusy(true);
    setPromoError(null);
    const result = await previewPromoAction(sessionId, chosen, code);
    setPromoBusy(false);
    if (result.ok) {
      setPromo(result);
      setPromoInput(result.code);
    } else {
      setPromo(null);
      setPromoError(result.error);
    }
  }

  // Enlace de un promotor: al elegir la primera entrada se aplica su código (una vez; si no aplica, se borra sin aviso).
  const pendingLinkPromo = useRef(linkPromo);
  useEffect(() => {
    const code = pendingLinkPromo.current;
    if (!code || promo || chosen.length === 0) return;
    pendingLinkPromo.current = undefined;
    void previewPromoAction(sessionId, chosen, code).then((result) => {
      if (result.ok) {
        setPromo(result);
        setPromoInput(result.code);
      } else setPromoInput("");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia lo elegido
  }, [chosenKey]);

  // Si cambia lo elegido, el descuento se vuelve a calcular con el mismo código.
  useEffect(() => {
    if (!promo) return;
    const id = setTimeout(() => (chosen.length === 0 ? setPromo(null) : void applyPromo(promo.code)), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe reaccionar a cambios de la selección
  }, [chosenKey]);
  const selected = new Set(Object.values(seats).flat());

  function toggleSeat(ticketTypeId: string, seatId: string) {
    setNotice(null);
    const type = seated.find((t) => t.ticketTypeId === ticketTypeId)!;
    const current = seats[ticketTypeId] ?? [];
    // Mesa completa: tocar una silla elige (o suelta) todas las de su mesa.
    if (type.seatedTables?.mode === "WHOLE") {
      const group = type.seats.find((s) => s.id === seatId)?.group;
      const table = type.seats.filter((s) => s.group === group);
      const name = `${type.seatedTables.prefix} ${group}`;
      if (table.some((s) => current.includes(s.id))) {
        setPicked({ ...seats, [ticketTypeId]: current.filter((id) => !table.some((s) => s.id === id)) });
      } else if (table.some((s) => s.taken)) {
        setNotice(`${name} ya tiene sillas vendidas: elige otra mesa.`);
      } else if (current.length + table.length > type.maxPerOrder || totalTickets + table.length > MAX_TICKETS_PER_ORDER) {
        setNotice(`Con ${name} (${table.length} sillas) pasarías el máximo de ${Math.min(type.maxPerOrder, MAX_TICKETS_PER_ORDER)} entradas por compra.`);
      } else {
        setPicked({ ...seats, [ticketTypeId]: [...current, ...table.map((s) => s.id)] });
      }
      return;
    }
    if (current.includes(seatId)) {
      setPicked({ ...seats, [ticketTypeId]: current.filter((id) => id !== seatId) });
    } else if (current.length >= type.maxPerOrder) {
      setNotice(`Máximo ${type.maxPerOrder} ${type.table ? "mesas" : "butacas"} en ${type.name} por compra.`);
    } else if (totalTickets >= MAX_TICKETS_PER_ORDER) {
      setNotice(`Máximo ${MAX_TICKETS_PER_ORDER} entradas por compra.`);
    } else {
      setPicked({ ...seats, [ticketTypeId]: [...current, seatId] });
    }
  }

  /** Butacas comunes (no mesas ni lounges): las que admiten "mejor disponible" y el aviso de asiento suelto. */
  const plainSeated = seated.filter((t) => !t.round && !t.seatedTables);
  const pickSeats = (t: SeatedType): PickSeat[] => t.seats.map((s) => ({ id: s.id, row: s.group ?? "", number: s.short ?? "", x: s.x, y: s.y, taken: s.taken }));
  const [bestCount, setBestCount] = useState<Record<string, number>>({});

  /** "Mejores lugares": los N juntos más adelante y al centro, sin dejar uno suelto (reemplaza lo elegido de ese tipo). */
  function pickBest(t: SeatedType) {
    setNotice(null);
    const count = bestCount[t.ticketTypeId] ?? 2;
    const others = totalTickets - (seats[t.ticketTypeId]?.length ?? 0);
    if (count > t.maxPerOrder || others + count > MAX_TICKETS_PER_ORDER) {
      setNotice(`Máximo ${Math.min(t.maxPerOrder, MAX_TICKETS_PER_ORDER - others)} butacas de ${t.name} en esta compra.`);
      return;
    }
    const best = bestAvailableSeats(pickSeats(t), count);
    if (!best) {
      setNotice(`No quedan ${count} butacas juntas en ${t.name}: elígelas en el mapa.`);
      return;
    }
    setPicked({ ...seats, [t.ticketTypeId]: best.map((s) => s.id) });
  }

  // onSubmit (y no <form action>) para que React no borre los campos si hay un error.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Un asiento suelto entre lo elegido y lo vendido después no lo compra nadie: se avisa (sin impedir la compra).
    const loose = plainSeated.flatMap((t) => orphanSeats(pickSeats(t), new Set(seats[t.ticketTypeId] ?? [])).map((s) => `${t.name} ${s.row}-${s.number}`));
    if (loose.length > 0 && !window.confirm(`Con lo que elegiste queda un asiento suelto (${loose.slice(0, 3).join(", ")}) que difícilmente se venda. ¿Seguir igual?`)) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="promo" value={promo?.code ?? ""} />
      {holdCode && <input type="hidden" name="holdCode" value={holdCode} />}
      {Object.entries(seats).map(([type, ids]) =>
        ids.length ? <input key={type} type="hidden" name={`seats:${type}`} value={ids.join(",")} /> : null,
      )}

      {/* El mapa: para elegir butaca o zona, o al menos para ver por qué puerta se entra. */}
      {(seated.length > 0 || zones.length > 0 || items.some((i) => i.kind === "ENTRANCE")) && (
        <section className="card space-y-4 p-4 sm:p-6">
          <h2 className="font-display text-xl">
            {seated.length > 0 ? (seated.every((t) => t.table) ? "1. Elige tu mesa en el mapa" : "1. Elige tus butacas") : "Mapa del recinto"}
          </h2>
          <SeatPicker sections={seated} selected={selected} onToggle={toggleSeat} zones={zones} zoneCounts={zoneCounts} onZoneClick={goToZone} items={items} />
          {plainSeated.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-[var(--ink-muted)]">Mejores lugares disponibles:</span>
              {plainSeated.map((t) => (
                <span key={t.ticketTypeId} className="flex items-center gap-1.5">
                  <select
                    aria-label={`Cuántas butacas en ${t.name}`}
                    value={bestCount[t.ticketTypeId] ?? 2}
                    onChange={(e) => setBestCount({ ...bestCount, [t.ticketTypeId]: Number(e.target.value) })}
                    className="rounded-md border border-[var(--border)] bg-[var(--bg-raised)] px-2 py-1"
                  >
                    {Array.from({ length: Math.min(t.maxPerOrder, MAX_TICKETS_PER_ORDER) }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => pickBest(t)} className="rounded-md border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]">
                    en {t.name}
                  </button>
                </span>
              ))}
            </div>
          )}
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--ink-muted)]">
            {seated.map((t) => (
              <li key={t.ticketTypeId} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                {t.name}
                {t.presale && <span className="font-semibold text-[var(--accent-2)]">(preventa)</span>}
                {t.discountPercent ? <span className="font-semibold text-[var(--accent-2)]"> (-{t.discountPercent}% preventa)</span> : null}
                {t.table && (
                  <span className="text-[#D985B8]">
                    {" "}
                    · mesa para {t.table.people}
                    {t.consumption ? `, incluye ${t.consumption} de consumo` : ""}
                  </span>
                )}
                {t.includes && <span className="font-semibold text-[var(--accent-text)]"> · {t.includes.toLowerCase()}</span>}
                :{" "}
                <span className="text-[var(--ink)]">{formatMoney(t.unitAmount, t.currency)}</span>
                {(seats[t.ticketTypeId]?.length ?? 0) > 0 && (
                  <span className="text-[var(--accent-text)]">× {seats[t.ticketTypeId]!.length}</span>
                )}
              </li>
            ))}
          </ul>
          {seated
            .filter((t) => t.seatedTables && t.seatedTables.mode !== "SEAT")
            .map((t) => (
              <p key={t.ticketTypeId} className="text-sm text-[var(--ink-muted)]">
                <strong className="text-[var(--ink)]">{t.name}:</strong>{" "}
                {t.seatedTables!.mode === "WHOLE"
                  ? `toca una mesa para llevarte sus ${t.seatedTables!.chairs} sillas (${formatMoney(t.unitAmount * t.seatedTables!.chairs, t.currency)} la mesa).`
                  : t.seatedTables!.min === t.seatedTables!.max
                    ? `elige ${t.seatedTables!.min} sillas de cada mesa.`
                    : `elige de ${t.seatedTables!.min} a ${t.seatedTables!.max} sillas de cada mesa.`}
              </p>
            ))}
          {notice && <p className="text-sm text-[var(--accent-2)]">{notice}</p>}
        </section>
      )}

      {general.length > 0 && (
        <section className="card">
          <h2 className="border-b border-[var(--border)] px-5 py-4 font-display text-xl">
            {seated.length ? "Entradas generales" : "1. Elige tus entradas"}
          </h2>
          <ul className="divide-y divide-[var(--border)]">
            {general.map((type, index) => (
              <li
                key={type.id}
                // Solo el primer tipo de la zona lleva el ancla: el mapa salta a ella.
                id={type.sectionId && general.findIndex((t) => t.sectionId === type.sectionId) === index ? `zona-${type.sectionId}` : undefined}
                className={`flex items-center justify-between gap-4 px-5 py-4 transition-colors ${type.sectionId && flash === type.sectionId ? "bg-[var(--highlight)]/15" : ""}`}
              >
                <div>
                  <p className="font-semibold">
                    {type.name}
                    {type.phase && (
                      <span className="ml-2 rounded-full bg-[var(--highlight)]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent-text)]">
                        {type.phase}
                      </span>
                    )}
                    {type.presaleUntil && (
                      <span className="ml-2 rounded-full bg-[var(--accent-2)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent-2)]">
                        Preventa
                      </span>
                    )}
                    {type.table && (
                      <span className="ml-2 rounded-full bg-[#AD468D]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#D985B8]">
                        Mesa · {type.table.people} personas
                      </span>
                    )}
                    {type.entryUntil && type.unitAmount === 0 && (
                      <span className="ml-2 rounded-full bg-[#35C48F]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#35C48F]">
                        Free
                      </span>
                    )}
                  </p>
                  {type.detail && <p className="text-xs text-[var(--ink-dim)]">{type.detail}</p>}
                  {type.includes && <p className="text-xs font-semibold text-[var(--accent-text)]">{type.includes}</p>}
                  {type.table && (
                    <p className="text-xs text-[var(--ink-muted)]">Cada persona de la mesa recibe su QR para entrar (puedes pasárselo desde Mis entradas).</p>
                  )}
                  {type.consumption && (
                    <p className="text-xs font-semibold text-[#F5B700]">
                      Incluye {type.consumption} de consumo en barra{type.table ? " para la mesa" : ""}
                    </p>
                  )}
                  {type.entryUntil && (
                    <p className="text-xs font-semibold text-[#35C48F]">
                      Válida para entrar hasta las {type.entryUntil}
                      {type.unitAmount === 0 ? " · una por persona" : ""}
                    </p>
                  )}
                  {type.presaleUntil && <p className="text-xs text-[var(--accent-2)]">Hasta {type.presaleUntil}</p>}
                  <p className="font-display text-lg text-[var(--accent-text)]">
                    {type.listAmount !== null && (
                      <span className="mr-2 text-sm text-[var(--ink-dim)] line-through">{formatMoney(type.listAmount, type.currency)}</span>
                    )}
                    {formatMoney(type.unitAmount, type.currency)}
                  </p>
                  {type.discountLabel && <p className="text-xs font-semibold text-[var(--accent-2)]">Preventa: {type.discountLabel}</p>}
                  {!type.opensAt && type.left > 0 && (
                    <p className={`text-xs ${type.left <= (type.table ? 3 : 20) ? "font-bold text-[var(--accent-2)]" : "text-[var(--ink-dim)]"}`}>
                      {type.table
                        ? type.left === 1
                          ? "¡Última mesa!"
                          : `Quedan ${type.left} mesas`
                        : type.left <= 20
                          ? `¡Últimos ${type.left} lugares!`
                          : `Quedan ${type.left}`}
                    </p>
                  )}
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
          <Link href={`/cuenta/datos?next=${encodeURIComponent(`/comprar/${sessionId}`)}`} className="text-[var(--accent-text)] underline underline-offset-4">
            Editar mis datos
          </Link>
        </p>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-display text-xl">3. Código promocional</h2>
        {promo ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--green)]/10 px-4 py-3 text-sm">
            <p>
              <strong className="font-mono">{promo.code}</strong> aplicado ({promo.label})
              {promo.discountAmount > 0 && (
                <>
                  : <strong>−{formatMoney(promo.discountAmount, currency)}</strong>
                </>
              )}
            </p>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => {
                setPromo(null);
                setPromoInput("");
              }}
            >
              Quitar
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-3">
            <input
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void applyPromo(promoInput);
                }
              }}
              placeholder="¿Tienes un código?"
              autoComplete="off"
              className="field w-56 font-mono"
              aria-label="Código promocional"
            />
            <button type="button" disabled={promoBusy || !promoInput.trim() || chosen.length === 0} onClick={() => void applyPromo(promoInput)} className="btn-accent">
              {promoBusy ? "Revisando…" : "Aplicar"}
            </button>
            {chosen.length === 0 && promoInput.trim() && <p className="basis-full text-xs text-[var(--ink-dim)]">Elige tus entradas y aplica el código.</p>}
          </div>
        )}
        {promoError && (
          <p role="alert" className="text-sm text-[var(--accent-2)]">
            {promoError}
          </p>
        )}
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
            {tableQrs > 0 && ` · las mesas traen ${tableQrs} QR`}
          </p>
          {promo && promo.discountAmount > 0 && (
            <p className="text-xs text-[var(--green)]">
              Descuento {promo.code}: −{formatMoney(promo.discountAmount, currency)}
            </p>
          )}
          <p className="font-display text-2xl tabular-nums">{formatMoney(promo ? Math.max(0, total - promo.discountAmount) : total, currency)}</p>
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
