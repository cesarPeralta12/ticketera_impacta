import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatCode, formatDateTime } from "@ticketera/core";
import { prisma, type Prisma } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { startOfToday } from "@/lib/dates";
import { SCAN_LABEL } from "@/lib/labels";
import { ROLES, eventScope, isGlobalView, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ingresos en puerta" };

type Props = { searchParams: Promise<{ org?: string; solo?: string }> };

/**
 * Entradas que se van registrando en las puertas, en vivo. IMPACTA (vista general) ve las de
 * todos los organizadores; un organizador, solo las de sus eventos.
 */
export default async function EntriesPage({ searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const global = isGlobalView(staff);
  const { org = "", solo = "" } = await searchParams;

  const eventFilter: Prisma.EventWhereInput = global && org ? { organizationId: org } : eventScope(staff);
  const scope: Prisma.AccessScanWhereInput = { session: { event: eventFilter } };
  const since = startOfToday();

  const [scans, acceptedToday, rejectedToday, organizers] = await Promise.all([
    prisma.accessScan.findMany({
      where: { ...scope, ...(solo === "rechazos" ? { result: { not: "ACCEPTED" } } : {}) },
      orderBy: { scannedAt: "desc" },
      take: 150,
      include: {
        ticket: {
          select: {
            code: true,
            holderName: true,
            ticketType: { select: { name: true } },
            seat: { select: { label: true } },
            order: { select: { buyerName: true } },
          },
        },
        session: {
          select: {
            id: true,
            startsAt: true,
            event: { select: { id: true, title: true, organization: { select: { name: true } } } },
            venue: { select: { timezone: true } },
          },
        },
        accessPoint: { select: { name: true } },
        operator: { select: { name: true } },
      },
    }),
    prisma.accessScan.count({ where: { ...scope, result: "ACCEPTED", scannedAt: { gte: since } } }),
    prisma.accessScan.count({ where: { ...scope, result: { not: "ACCEPTED" }, scannedAt: { gte: since } } }),
    global ? prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={15} />
      <div>
        <p className="eyebrow">{global ? "Todos los organizadores" : staff.organization.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Ingresos en puerta</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Cada lectura de QR en las puertas: quién entró, por dónde y con qué equipo, y los rechazos. Se actualiza
          cada 15 segundos.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4">
          <p className="eyebrow">Ingresaron hoy</p>
          <p className="mt-1 font-mono text-2xl text-[var(--accent)]">{acceptedToday}</p>
        </div>
        <div className="card p-4">
          <p className="eyebrow">Rechazos hoy</p>
          <p className="mt-1 font-mono text-2xl text-[var(--danger)]">{rejectedToday}</p>
        </div>
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4">
        <label className="label">
          Mostrar
          <select name="solo" defaultValue={solo} className="field">
            <option value="">Todas las lecturas</option>
            <option value="rechazos">Solo rechazos</option>
          </select>
        </label>
        {global && (
          <label className="label">
            Organizador
            <select name="org" defaultValue={org} className="field">
              <option value="">Todos</option>
              {organizers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="btn">
          Filtrar
        </button>
        {(org || solo) && (
          <Link href="/ingresos" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
            Limpiar
          </Link>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="eyebrow border-b border-[var(--border)]">
            <tr>
              <th className="px-4 py-3 font-normal">Hora</th>
              <th className="px-4 py-3 font-normal">Persona</th>
              <th className="px-4 py-3 font-normal">Evento</th>
              <th className="px-4 py-3 font-normal">Puerta · equipo</th>
              <th className="px-4 py-3 font-normal">Resultado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {scans.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--ink-muted)]">
                  Todavía no hay lecturas en puerta.
                </td>
              </tr>
            )}
            {scans.map((s) => {
              const tz = s.session.venue.timezone;
              return (
                <tr key={s.id} className="align-top">
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {formatDateTime(s.scannedAt, tz)}
                    {s.offline && <span className="block text-[var(--warn)]">sin conexión</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {s.ticket ? (
                      <>
                        <p>{s.ticket.holderName ?? s.ticket.order.buyerName}</p>
                        <p className="text-xs text-[var(--ink-dim)]">
                          {s.ticket.ticketType.name}
                          {s.ticket.seat ? ` · ${s.ticket.seat.label}` : ""} · {formatCode(s.ticket.code)}
                        </p>
                      </>
                    ) : (
                      <p className="text-[var(--ink-dim)]">QR no reconocido</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <p>
                      <Link
                        href={`/eventos/${s.session.event.id}/funciones/${s.session.id}/en-vivo`}
                        className="text-[var(--accent)] hover:underline"
                        title="Ver el mapa y la lista de ingreso de esta función"
                      >
                        {s.session.event.title}
                      </Link>
                    </p>
                    {global && <p className="text-xs font-medium text-[var(--ink-muted)]">{s.session.event.organization.name}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--ink-muted)]">
                    {s.accessPoint?.name ?? "Sin puerta"}
                    {s.deviceId && <span className="block">{s.deviceId}</span>}
                    {s.operator && <span className="block">{s.operator.name}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`badge ${s.result === "ACCEPTED" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}
                    >
                      {SCAN_LABEL[s.result]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
