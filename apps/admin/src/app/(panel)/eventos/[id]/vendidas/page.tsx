import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatCode, formatDateTime, formatMoney } from "@ticketera/core";
import { listSoldTickets, prisma, type TicketStatus } from "@ticketera/db";
import { FilterForm } from "@/components/filter-form";
import { PAGE_SIZE, Pager, pageFrom } from "@/components/pager";
import { CHANNEL_LABEL, TICKET_STATUS } from "@/lib/labels";
import { ROLES, eventScope, isGlobalView, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Entradas vendidas" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; noche?: string; estado?: string; manos?: string; pagina?: string }> };

/** «María Pérez» → «M. P.»; «1234567» → «•••4567»: lo que ven quienes no tienen permiso de ver nombres y carnets. */
const maskName = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}.`)
    .join(" ");
const maskDocument = (doc: string | null) => (doc ? `•••${doc.slice(-3)}` : null);

/**
 * Todas las entradas vendidas de un evento: quién la compró, quién la tiene ahora, en qué etapa se vendió y a qué precio.
 * Los nombres y carnets completos los ve solo el superadmin de iPass; el resto ve iniciales.
 */
export default async function SoldTicketsPage({ params, searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const { id } = await params;
  const { q = "", noche = "", estado = "", manos = "", pagina } = await searchParams;
  const event = await prisma.event.findFirst({
    where: { id, ...eventScope(staff) },
    select: {
      id: true,
      title: true,
      organization: { select: { currency: true } },
      sessions: { where: { cancelledAt: null }, orderBy: { startsAt: "asc" }, select: { id: true, startsAt: true, venue: { select: { name: true, timezone: true } } } },
    },
  });
  if (!event) notFound();
  const showNames = isGlobalView(staff);
  const status = estado === "VALID" || estado === "USED" || estado === "CANCELLED" ? (estado as TicketStatus) : undefined;
  const sessionId = event.sessions.some((s) => s.id === noche) ? noche : undefined;
  const filter = { eventId: event.id, q, sessionId, status, transferred: manos === "si" };
  const first = await listSoldTickets({ ...filter, page: 1, pageSize: 1 });
  const page = pageFrom(pagina, Math.ceil(first.total / PAGE_SIZE));
  const { total, rows } = await listSoldTickets({ ...filter, page, pageSize: PAGE_SIZE });
  const money = (cents: number) => formatMoney(cents, event.organization.currency);
  const who = (name: string) => (showNames ? name : maskName(name));
  const doc = (d: string | null) => (showNames ? d : maskDocument(d));

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/eventos/${event.id}`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← {event.title}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Entradas vendidas</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Cada entrada con su comprador, su titular actual y la etapa en que se vendió. Entra a una para ver su historia completa.
          {!showNames && " Los nombres y carnets completos solo los ve el superadmin de iPass."}
        </p>
      </div>

      <div className="card p-4">
        <FilterForm>
          <label className="label min-w-[14rem] flex-1">
            Buscar
            <input type="search" name="q" defaultValue={q} placeholder="Código, nombre o carnet" className="field" />
          </label>
          {event.sessions.length > 1 && (
            <label className="label">
              Noche
              <select name="noche" defaultValue={sessionId ?? ""} className="field">
                <option value="">Todas</option>
                {event.sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDateTime(s.startsAt, s.venue.timezone)} · {s.venue.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="label">
            Estado
            <select name="estado" defaultValue={status ?? ""} className="field">
              <option value="">Todas</option>
              <option value="VALID">Válidas (no ingresaron)</option>
              <option value="USED">Ingresaron</option>
              <option value="CANCELLED">Anuladas</option>
            </select>
          </label>
          <label className="label">
            Titular
            <select name="manos" defaultValue={manos} className="field">
              <option value="">Todas</option>
              <option value="si">Solo las transferidas</option>
            </select>
          </label>
        </FilterForm>
      </div>

      <p className="text-sm text-[var(--ink-muted)]">
        {total} entrada{total === 1 ? "" : "s"}
      </p>
      <div className="card overflow-x-auto">
        <table className="table-cards w-full text-left text-sm">
          <thead className="eyebrow border-b border-[var(--border)]">
            <tr>
              <th className="px-4 py-3 font-normal">Entrada</th>
              <th className="px-4 py-3 font-normal">Comprador</th>
              <th className="px-4 py-3 font-normal">Titular ahora</th>
              <th className="px-4 py-3 font-normal">Etapa · precio</th>
              <th className="px-4 py-3 font-normal">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--ink-muted)]">
                  No hay entradas con ese filtro.
                </td>
              </tr>
            )}
            {rows.map((t) => {
              const st = TICKET_STATUS[t.status];
              return (
                <tr key={t.id} className="align-top">
                  <td data-label="Entrada" className="px-4 py-2.5">
                    <Link href={`/entradas/${t.code}`} className="font-mono text-[var(--accent)] hover:underline">
                      {formatCode(t.code)}
                    </Link>
                    <p className="text-xs text-[var(--ink-dim)]">
                      {t.typeName} · {formatDateTime(t.startsAt, t.timezone)}
                    </p>
                    {t.externalCode && <p className="text-xs text-[var(--ink-dim)]">Proveedor: {t.externalCode}</p>}
                  </td>
                  <td data-label="Comprador" className="px-4 py-2.5">
                    <p>{who(t.buyerName)}</p>
                    <p className="text-xs text-[var(--ink-dim)]">
                      {doc(t.buyerDocument) ? `CI ${doc(t.buyerDocument)} · ` : ""}
                      {CHANNEL_LABEL[t.channel]} · {formatDateTime(t.orderedAt, t.timezone)}
                    </p>
                  </td>
                  <td data-label="Titular ahora" className="px-4 py-2.5">
                    <p>{who(t.holderName)}</p>
                    {t.changedHands && (
                      <p className="text-xs text-[var(--warn)]">
                        Cambió de manos ({t.transferCount} {t.transferCount === 1 ? "vez" : "veces"})
                      </p>
                    )}
                  </td>
                  <td data-label="Etapa · precio" className="px-4 py-2.5">
                    <p>
                      {t.stage.text}
                      {t.stage.estimated && <span className="text-xs text-[var(--ink-dim)]"> (estimado)</span>}
                    </p>
                    <p className="font-mono text-xs text-[var(--ink-muted)]">
                      {money(t.price)}
                      {t.extra > 0 && ` + ${money(t.extra)} de consumo`}
                    </p>
                  </td>
                  <td data-label="Estado" className="px-4 py-2.5">
                    <span className={`badge ${st.className}`}>{st.text}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager path={`/eventos/${event.id}/vendidas`} params={{ q, noche, estado, manos }} page={page} total={total} />
    </div>
  );
}
