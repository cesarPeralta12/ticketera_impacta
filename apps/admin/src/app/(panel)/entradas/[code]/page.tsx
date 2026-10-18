import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatCode, formatDateTime, tableLabel } from "@ticketera/core";
import { getTicketAccessHistory, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { correctPresenceAction } from "@/lib/actions/presence";
import { CHANNEL_LABEL, DIRECTION_LABEL, MOVEMENT_LABEL, SCAN_LABEL, TICKET_STATUS } from "@/lib/labels";
import { ROLES, eventScope, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Entrada" };

type Props = { params: Promise<{ code: string }> };

/** Una entrada: de quién es, si está adentro y en qué zona, cada lectura en puerta y la corrección manual. */
export default async function TicketPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const code = (await params).code.replace(/-/g, "").toUpperCase();
  const ticket = await prisma.ticket.findFirst({
    where: { code, session: { event: eventScope(staff) } },
    include: {
      ticketType: { select: { name: true, maxEntries: true, zones: { select: { name: true } } } },
      zone: { select: { name: true, color: true } },
      seat: { select: { label: true } },
      credit: { select: { tableNumber: true, seat: { select: { label: true } } } },
      order: { select: { code: true, channel: true, buyerName: true, buyerDocument: true } },
      session: {
        select: {
          id: true,
          eventId: true,
          startsAt: true,
          event: { select: { title: true } },
          venue: { select: { name: true, timezone: true, zones: { orderBy: [{ level: "asc" }, { name: "asc" }], select: { id: true, name: true } } } },
        },
      },
    },
  });
  if (!ticket) notFound();
  const history = await getTicketAccessHistory(ticket.id);
  const tz = ticket.session.venue.timezone;
  const status = TICKET_STATUS[ticket.status];
  const place = tableLabel(ticket.ticketType.name, ticket.credit?.tableNumber, ticket.credit?.seat?.label) ?? ticket.seat?.label;
  const max = ticket.ticketType.maxEntries;
  const editable = !staff.readOnly && ticket.status !== "CANCELLED";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href={`/eventos/${ticket.session.eventId}/funciones/${ticket.session.id}/en-vivo`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Ingreso en vivo · {ticket.session.event.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-medium">{formatCode(ticket.code)}</h1>
          <span className={`badge ${status.className}`}>{status.text}</span>
        </div>
        <p className="text-sm text-[var(--ink-muted)]">
          {ticket.holderName ?? ticket.order.buyerName}
          {ticket.order.buyerDocument && ` · CI ${ticket.order.buyerDocument}`} · {ticket.ticketType.name}
          {place && ` · ${place}`} · {CHANNEL_LABEL[ticket.order.channel]} (orden {formatCode(ticket.order.code)}) ·{" "}
          {formatDateTime(ticket.session.startsAt, tz)}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <dt className="text-xs text-[var(--ink-dim)]">Ahora</dt>
          <dd className="mt-1 text-lg font-semibold">
            {ticket.status === "CANCELLED" ? "Anulada" : ticket.inside ? "Adentro" : ticket.status === "USED" ? "Salió" : "No ingresó"}
          </dd>
        </div>
        <div className="card p-4">
          <dt className="text-xs text-[var(--ink-dim)]">Zona</dt>
          <dd className="mt-1 flex items-center gap-2 text-lg font-semibold">
            {ticket.zone && <span className="h-3 w-3 rounded-full" style={{ background: ticket.zone.color }} />}
            {ticket.inside ? (ticket.zone?.name ?? "General") : "—"}
          </dd>
        </div>
        <div className="card p-4">
          <dt className="text-xs text-[var(--ink-dim)]">Ingresos</dt>
          <dd className="mt-1 text-lg font-semibold">
            {ticket.entries} {max === 0 ? "(sin límite)" : `de ${max}`}
          </dd>
        </div>
        <div className="card p-4">
          <dt className="text-xs text-[var(--ink-dim)]">Abre</dt>
          <dd className="mt-1 text-sm font-medium">{ticket.ticketType.zones.length ? ticket.ticketType.zones.map((z) => z.name).join(", ") : "Las de siempre"}</dd>
        </div>
      </dl>

      <section className="card p-6">
        <h2 className="eyebrow mb-3">Historial en puerta</h2>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">Todavía no se leyó en ninguna puerta.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-left text-xs text-[var(--ink-dim)]">
                <tr>
                  <th className="py-1 font-normal">Hora</th>
                  <th className="py-1 font-normal">Qué pasó</th>
                  <th className="py-1 font-normal">Puerta</th>
                  <th className="py-1 font-normal">Zona</th>
                  <th className="py-1 font-normal">Quién</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="py-1.5 font-mono text-xs">{formatDateTime(h.scannedAt, tz)}</td>
                    <td className="py-1.5">
                      {h.result === "ACCEPTED" ? (
                        <span className="font-medium text-[var(--accent)]">{MOVEMENT_LABEL[h.movement ?? "ENTRY"]}</span>
                      ) : (
                        <span className="text-[var(--danger)]">Rechazada: {SCAN_LABEL[h.result]}</span>
                      )}
                      {h.offline && <span className="badge ml-2 bg-[var(--warn-soft)] text-[var(--warn)]">sin conexión</span>}
                      {h.movement === "MANUAL" && <span className="block text-xs text-[var(--ink-dim)]">{h.rawCode}</span>}
                    </td>
                    <td className="py-1.5">
                      {h.accessPoint ? gateWithDirection(h.accessPoint.name, DIRECTION_LABEL[h.accessPoint.direction].toLowerCase()) : "—"}
                    </td>
                    <td className="py-1.5">{h.zone?.name ?? "—"}</td>
                    <td className="py-1.5">{h.operator?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editable && (
        <section className="card space-y-3 p-6">
          <div>
            <h2 className="eyebrow">Corregir presencia</h2>
            <p className="text-sm text-[var(--ink-muted)]">
              Para cuando la puerta se equivocó (salió sin leer la salida, se leyó por error, se cortó la luz). Queda en el
              historial y en Seguridad con tu nombre y el motivo.
            </p>
          </div>
          <ActionForm action={correctPresenceAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <label className="label">
              Corrección
              <select name="action" defaultValue={ticket.inside ? "OUT" : "IN"} className="field">
                <option value="OUT">Está afuera (salió)</option>
                <option value="IN">Está adentro</option>
                {ticket.status === "USED" && <option value="RESET">No ingresó (se leyó por error)</option>}
              </select>
            </label>
            {ticket.session.venue.zones.length > 0 && (
              <label className="label">
                Zona (si está adentro)
                <select name="zoneId" defaultValue="" className="field">
                  <option value="">Sin zona (ingreso general)</option>
                  {ticket.session.venue.zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="label min-w-[16rem] flex-1">
              Motivo
              <input name="reason" required minLength={3} maxLength={160} placeholder="ej. salió por la emergencia sin leer" className="field" />
            </label>
            <button type="submit" className="btn btn-dark">
              Guardar corrección
            </button>
          </ActionForm>
        </section>
      )}
    </div>
  );
}

/** "Puerta principal (entrada)"; sin repetir cuando el nombre ya lo dice ("Salida", no "Salida (salida)"). */
function gateWithDirection(name: string, direction: string) {
  return name.toLowerCase().includes(direction) ? name : `${name} (${direction})`;
}
