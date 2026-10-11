"use client";

import { useMemo, useState } from "react";
import { CANVAS_HEIGHT, CANVAS_WIDTH, formatCode } from "@ticketera/core";
import type { LiveAccess, LiveScan, LiveTicket } from "@ticketera/db";

const RESULT_LABEL: Record<string, string> = {
  ACCEPTED: "Aceptada",
  ALREADY_USED: "Reingreso (ya usada)",
  NOT_FOUND: "No existe",
  CANCELLED: "Anulada",
  WRONG_SESSION: "Otra función",
  WRONG_GATE: "Puerta equivocada",
  INVALID: "Código inválido",
  METHOD_NOT_ALLOWED: "Método no permitido",
  QR_EXPIRED: "QR vencido (captura)",
  STATIC_NOT_ALLOWED: "Exige QR dinámico",
};

const METHOD_LABEL: Record<string, string> = { QR: "QR", BARCODE: "Código de barras", NFC: "NFC", MANUAL: "Código escrito" };

const FREE = "#e6e4dc";
const SOLD = "#8aa0b8";
const ENTERED = "#16a34a";
const CANCELLED = "#dc2626";

function time(iso: string, timeZone: string) {
  // 24 h y locale fijo: el servidor y el navegador deben escribir exactamente lo mismo (evita errores de hidratación).
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(iso));
}

/** Estado en vivo de una función: mapa de butacas, listas por zona, detalle de cada entrada y rechazos. */
export function LiveAccessBoard({ data }: { data: NonNullable<LiveAccess> }) {
  const tz = data.session.timezone;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyEntered, setOnlyEntered] = useState(false);

  const bySeat = useMemo(() => new Map(data.tickets.filter((t) => t.seatId).map((t) => [t.seatId!, t])), [data.tickets]);
  const selected = data.tickets.find((t) => t.id === selectedId) ?? null;
  const seated = data.sections.filter((s) => s.seatingMode === "RESERVED" && s.seats.length > 0);
  const zones = data.sections.filter((s) => s.seatingMode === "GENERAL_ADMISSION");
  const pct = data.totals.issued === 0 ? 0 : Math.round((data.totals.entered / data.totals.issued) * 100);

  return (
    <div className="space-y-6">
      {/* Resumen */}
      <section className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Ingresaron</p>
            <p className="text-4xl font-bold tabular-nums">
              {data.totals.entered} <span className="text-xl font-medium text-[var(--ink-dim)]">/ {data.totals.issued}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {data.gates.map((g) => (
              <span key={g.id} className="rounded-md border border-[var(--border)] px-3 py-1.5">
                {g.name}: <strong className="tabular-nums">{g.entered}</strong>
              </span>
            ))}
            <span className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--danger)]">
              Rechazos: <strong className="tabular-nums">{data.totals.rejected}</strong>
            </span>
            {data.totals.qrExpired > 0 && (
              <span className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--warn)]" title="Intentos con una captura de pantalla o un QR viejo">
                QR vencidos: <strong className="tabular-nums">{data.totals.qrExpired}</strong>
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: ENTERED }} />
        </div>
      </section>

      <div className="space-y-6">
        <div className="space-y-6">
          {/* Mapa de butacas */}
          {seated.length > 0 && (
            <section className="card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="eyebrow">Mapa del recinto · toca una butaca vendida para ver quién es</h2>
                <ul className="flex flex-wrap items-center gap-3 text-xs text-[var(--ink-muted)]">
                  <Legend color={FREE} label="Sin vender" />
                  <Legend color={SOLD} label="Vendida" />
                  <Legend color={ENTERED} label="Ya ingresó" />
                  <Legend color={CANCELLED} label="Anulada" />
                </ul>
              </div>
              <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} className="w-full rounded-lg border border-[var(--border)]" style={{ background: "#fbfbf9" }} role="img" aria-label="Mapa de butacas en vivo">
                <rect x={CANVAS_WIDTH / 2 - 160} y={16} width={320} height={20} rx={4} fill="#1a1a18" />
                <text x={CANVAS_WIDTH / 2} y={30} textAnchor="middle" fontSize="10" letterSpacing="2" fill="#fff">
                  ESCENARIO
                </text>
                {seated.map((section) =>
                  section.seats.map((seat) => {
                    const ticket = bySeat.get(seat.id);
                    const fill = !ticket ? FREE : ticket.status === "USED" ? ENTERED : ticket.status === "CANCELLED" ? CANCELLED : SOLD;
                    const isSelected = ticket?.id === selectedId;
                    return (
                      <circle
                        key={seat.id}
                        cx={seat.x}
                        cy={seat.y}
                        r={isSelected ? 8 : 6}
                        fill={fill}
                        stroke={isSelected ? "#111" : section.color}
                        strokeWidth={isSelected ? 2.5 : 1}
                        className={ticket ? "cursor-pointer" : ""}
                        onClick={() => ticket && setSelectedId(ticket.id)}
                      >
                        <title>{ticket ? `${seat.label} · ${ticket.holder}${ticket.status === "USED" ? " · ya ingresó" : ""}` : `${seat.label} · sin vender`}</title>
                      </circle>
                    );
                  }),
                )}
              </svg>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {seated.map((s) => (
                  <li key={s.id} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    {s.name}: <strong className="tabular-nums">{s.entered}</strong> / {s.issued}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Zonas sin asientos: lista con nombre, carnet y código */}
          {zones.map((zone) => {
            const all = data.tickets.filter((t) => t.sectionId === zone.id && t.status !== "CANCELLED");
            const q = query.trim().toLowerCase();
            const rows = all.filter(
              (t) =>
                (!onlyEntered || t.status === "USED") &&
                (!q || t.holder.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || (t.document ?? "").toLowerCase().includes(q)),
            );
            return (
              <ZoneList
                key={zone.id}
                name={zone.name}
                color={zone.color}
                issued={zone.issued}
                entered={zone.entered}
                rows={rows}
                query={query}
                onQuery={setQuery}
                onlyEntered={onlyEntered}
                onOnlyEntered={setOnlyEntered}
                selectedId={selectedId}
                onSelect={setSelectedId}
                tz={tz}
              />
            );
          })}
        </div>

      </div>

      {/* Detalle de la entrada elegida: panel flotante, visible sin importar dónde se tocó */}
      {selected && (
        <aside className="fixed bottom-4 right-4 z-30 max-h-[75vh] w-[min(360px,calc(100vw-2rem))] overflow-y-auto rounded-xl shadow-2xl print:hidden">
          <TicketDetail ticket={selected} tz={tz} onClose={() => setSelectedId(null)} />
        </aside>
      )}

      {/* Rechazos */}
      <section className="card">
        <h2 className="eyebrow border-b border-[var(--border)] px-5 py-3">Intentos rechazados (últimos {data.rejected.length})</h2>
        {data.rejected.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">Todavía no hubo rechazos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="eyebrow border-b border-[var(--border)]">
                <tr>
                  <th className="px-5 py-2 font-normal">Hora</th>
                  <th className="px-3 py-2 font-normal">Motivo</th>
                  <th className="px-3 py-2 font-normal">Entrada</th>
                  <th className="px-3 py-2 font-normal">Puerta</th>
                  <th className="px-3 py-2 font-normal">Portero</th>
                  <th className="px-3 py-2 font-normal">Método</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.rejected.map((r, i) => (
                  <tr key={i} className={r.ticketId ? "cursor-pointer" : ""} onClick={() => r.ticketId && setSelectedId(r.ticketId)}>
                    <td className="px-5 py-2 font-mono text-xs">{time(r.at, tz)}</td>
                    <td className="px-3 py-2">
                      <span className="badge bg-[var(--danger-soft)] text-[var(--danger)]">{RESULT_LABEL[r.result] ?? r.result}</span>
                    </td>
                    <td className="px-3 py-2">
                      {r.holder && <span className="block font-medium">{r.holder}</span>}
                      <span className="font-mono text-xs text-[var(--ink-muted)]">{r.code.length === 10 ? formatCode(r.code) : r.code}</span>
                    </td>
                    <td className="px-3 py-2">{r.gate ?? "—"}</td>
                    <td className="px-3 py-2">{r.operator ?? "—"}</td>
                    <td className="px-3 py-2">{r.method ? (METHOD_LABEL[r.method] ?? r.method) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-full" style={{ background: color }} />
      {label}
    </li>
  );
}

const PAGE = 300;

function ZoneList(props: {
  name: string;
  color: string;
  issued: number;
  entered: number;
  rows: LiveTicket[];
  query: string;
  onQuery: (q: string) => void;
  onlyEntered: boolean;
  onOnlyEntered: (v: boolean) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  tz: string;
}) {
  const [limit, setLimit] = useState(PAGE);
  const shown = props.rows.slice(0, limit);
  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <span className="h-3 w-3 rounded-full" style={{ background: props.color }} />
          {props.name}
          <span className="text-sm font-normal text-[var(--ink-muted)]">
            Ingresaron <strong className="tabular-nums">{props.entered}</strong> de {props.issued}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
            <input type="checkbox" checked={props.onlyEntered} onChange={(e) => props.onOnlyEntered(e.target.checked)} className="accent-[var(--accent)]" />
            Solo los que ingresaron
          </label>
          <input value={props.query} onChange={(e) => props.onQuery(e.target.value)} placeholder="Buscar nombre, carnet o código" className="field w-60 py-1.5 text-xs" />
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">No hay entradas que coincidan.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="eyebrow border-b border-[var(--border)]">
              <tr>
                <th className="px-5 py-2 font-normal">N°</th>
                <th className="px-3 py-2 font-normal">Nombre</th>
                <th className="px-3 py-2 font-normal">Carnet</th>
                <th className="px-3 py-2 font-normal">Código</th>
                <th className="px-3 py-2 font-normal">Tipo</th>
                <th className="px-3 py-2 font-normal">Ingreso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {shown.map((t, i) => {
                const entered = t.status === "USED";
                return (
                  <tr
                    key={t.id}
                    onClick={() => props.onSelect(t.id)}
                    className={`cursor-pointer ${entered ? "bg-[#e6f6ec]" : ""} ${t.id === props.selectedId ? "outline outline-2 -outline-offset-2 outline-[var(--ink)]" : ""}`}
                  >
                    <td className="px-5 py-2 font-mono text-xs text-[var(--ink-dim)]">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{t.holder}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t.document ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{formatCode(t.code)}</td>
                    <td className="px-3 py-2">{t.type}</td>
                    <td className="px-3 py-2">
                      {entered && t.entry ? (
                        <span className="font-medium text-[#15803d]">
                          ✓ {time(t.entry.at, props.tz)}
                          {t.entry.gate && <span className="font-normal text-[var(--ink-muted)]"> · {t.entry.gate}</span>}
                        </span>
                      ) : (
                        <span className="text-[var(--ink-dim)]">Pendiente</span>
                      )}
                      {t.attempts.length > 0 && <span className="badge ml-2 bg-[var(--danger-soft)] text-[var(--danger)]">{t.attempts.length} rechazo(s)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {props.rows.length > limit && (
        <div className="border-t border-[var(--border)] p-3 text-center">
          <button type="button" className="btn text-xs" onClick={() => setLimit((l) => l + PAGE)}>
            Mostrar más ({props.rows.length - limit} restantes)
          </button>
        </div>
      )}
    </section>
  );
}

function ScanLine({ scan, tz }: { scan: LiveScan; tz: string }) {
  return (
    <li className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className={`badge ${scan.result === "ACCEPTED" ? "bg-[#e6f6ec] text-[#15803d]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>
          {RESULT_LABEL[scan.result] ?? scan.result}
        </span>
        <span className="font-mono text-xs">{time(scan.at, tz)}</span>
      </div>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">
        {scan.gate ?? "Sin puerta"} · {scan.operator ?? "—"} · {scan.method ? (METHOD_LABEL[scan.method] ?? scan.method) : "—"}
      </p>
    </li>
  );
}

function TicketDetail({ ticket, tz, onClose }: { ticket: LiveTicket; tz: string; onClose: () => void }) {
  const entered = ticket.status === "USED";
  return (
    <div className="card space-y-4 p-5">
      <div className="relative">
        <button type="button" onClick={onClose} aria-label="Cerrar detalle" className="absolute right-0 top-0 rounded-md px-2 py-0.5 text-lg leading-none text-[var(--ink-dim)] hover:bg-[var(--surface-2)]">
          ×
        </button>
        <p className="eyebrow">Detalle de la entrada</p>
        <p className="mt-1 pr-8 text-xl font-bold leading-tight">{ticket.holder}</p>
        <span
          className={`badge mt-2 ${entered ? "bg-[#e6f6ec] text-[#15803d]" : ticket.status === "CANCELLED" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--surface-2)] text-[var(--ink)]"}`}
        >
          {entered ? "Ya ingresó" : ticket.status === "CANCELLED" ? "Anulada" : "Aún no ingresa"}
        </span>
      </div>
      <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 text-sm">
        <dt className="text-[var(--ink-muted)]">Carnet</dt>
        <dd className="font-mono">{ticket.document ?? "—"}</dd>
        <dt className="text-[var(--ink-muted)]">Entrada</dt>
        <dd>{ticket.type}</dd>
        {ticket.seatLabel && (
          <>
            <dt className="text-[var(--ink-muted)]">Asiento</dt>
            <dd>{ticket.seatLabel}</dd>
          </>
        )}
        <dt className="text-[var(--ink-muted)]">Código</dt>
        <dd className="font-mono">{formatCode(ticket.code)}</dd>
      </dl>
      {ticket.entry && (
        <div>
          <h3 className="eyebrow mb-1.5">Ingreso</h3>
          <ul>
            <ScanLine scan={ticket.entry} tz={tz} />
          </ul>
          {ticket.entry.device && <p className="mt-1 text-xs text-[var(--ink-dim)]">Teléfono: {ticket.entry.device.slice(0, 8)}…</p>}
        </div>
      )}
      <div>
        <h3 className="eyebrow mb-1.5">Intentos rechazados ({ticket.attempts.length})</h3>
        {ticket.attempts.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">Ninguno.</p>
        ) : (
          <ul className="space-y-1.5">
            {ticket.attempts.map((a, i) => (
              <ScanLine key={i} scan={a} tz={tz} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
