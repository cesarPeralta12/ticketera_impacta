import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, describeUserAgent, formatDateTime, zonedDateTimeToUtc } from "@ticketera/core";
import { listAuditEvents, securitySummary, type AuditScope } from "@ticketera/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { SECURITY_FILTERS, actionLabel, describeData } from "@/lib/audit-labels";
import { ROLES, isGlobalView, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Seguridad" };

type Props = {
  searchParams: Promise<{ ambito?: string; accion?: string; cuenta?: string; ip?: string; desde?: string; hasta?: string; alertas?: string; pagina?: string }>;
};

const SCOPES: { value: AuditScope; label: string }[] = [
  { value: "security", label: "Accesos y seguridad" },
  { value: "changes", label: "Cambios en el sistema" },
  { value: "all", label: "Todo" },
];

const dayStart = (value: string | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? zonedDateTimeToUtc(`${value}T00:00`, DEFAULT_TIMEZONE) : undefined;

/**
 * Registro de seguridad: quién entró, quién falló, qué cambió y desde dónde (IP, navegador o teléfono).
 * IMPACTA ve todo; cada organizador, solo lo de su organización.
 */
export default async function SecurityPage({ searchParams }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const global = isGlobalView(staff);
  const organizationId = global ? undefined : staff.organization.id;
  const q = await searchParams;
  const scope = SCOPES.some((s) => s.value === q.ambito) ? (q.ambito as AuditScope) : "security";
  const page = Math.max(Number(q.pagina) || 1, 1);
  const from = dayStart(q.desde);
  const toDay = dayStart(q.hasta);
  const to = toDay ? new Date(toDay.getTime() + 24 * 3_600_000) : undefined; // "hasta" incluye ese día

  const now = new Date();
  const [summary, events] = await Promise.all([
    securitySummary({ organizationId, since: new Date(now.getTime() - 24 * 3_600_000) }),
    listAuditEvents({
      organizationId,
      scope,
      onlyWarnings: q.alertas === "1",
      actor: q.cuenta,
      action: q.accion || undefined,
      ip: q.ip,
      from,
      to,
      page,
      pageSize: 50,
    }),
  ]);

  const filtered = Boolean(q.accion || q.cuenta || q.ip || q.desde || q.hasta || q.alertas);
  const pages = Math.max(1, Math.ceil(events.total / events.pageSize));
  const link = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...q, pagina: String(p) })) if (v) params.set(k, v);
    return `/seguridad?${params.toString()}`;
  };

  const cards = [
    { label: "Ingresos fallidos", value: summary.failedLogins, warn: summary.failedLogins >= 5 },
    { label: "Bloqueos", value: summary.blocked, warn: summary.blocked > 0 },
    { label: "Dispositivos nuevos", value: summary.newDevices, warn: false },
    { label: "Sesiones cerradas", value: summary.sessionsRevoked, warn: false },
    { label: "Tokens reutilizados", value: summary.tokenReuse, warn: summary.tokenReuse > 0 },
  ];

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={60} />
      <div>
        <p className="eyebrow">{global ? "Todas las organizaciones" : staff.organization.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Seguridad</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Quién hizo qué, cuándo y desde dónde. Los eventos de acceso se guardan 12 meses; los cambios del sistema, siempre.
        </p>
      </div>

      <section>
        <h2 className="eyebrow mb-2">Últimas 24 horas</h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {cards.map((c) => (
            <div key={c.label} className="card p-4">
              <dt className="eyebrow">{c.label}</dt>
              <dd className={`mt-1 text-2xl font-semibold tabular-nums ${c.warn ? "text-[var(--warn)]" : ""}`}>{c.value}</dd>
            </div>
          ))}
        </dl>
        {summary.topIps.length > 0 && (
          <p className="mt-2 text-xs text-[var(--ink-muted)]">
            IP con más intentos fallidos:{" "}
            {summary.topIps.map((t, i) => (
              <span key={t.ip}>
                {i > 0 && " · "}
                <Link href={`/seguridad?ip=${encodeURIComponent(t.ip)}`} className="font-mono hover:underline">
                  {t.ip}
                </Link>{" "}
                ({t.count})
              </span>
            ))}
          </p>
        )}
      </section>

      <form className="card flex flex-wrap items-end gap-3 p-4">
        <label className="label">
          Ver
          <select name="ambito" defaultValue={scope} className="field">
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Tipo
          <select name="accion" defaultValue={q.accion ?? ""} className="field">
            {SECURITY_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="label min-w-48 flex-1">
          Cuenta
          <input name="cuenta" defaultValue={q.cuenta ?? ""} placeholder="Correo o nombre" className="field" />
        </label>
        <label className="label">
          IP
          <input name="ip" defaultValue={q.ip ?? ""} placeholder="200.87." className="field w-32" />
        </label>
        <label className="label">
          Desde
          <input name="desde" type="date" defaultValue={q.desde ?? ""} className="field" />
        </label>
        <label className="label">
          Hasta
          <input name="hasta" type="date" defaultValue={q.hasta ?? ""} className="field" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="alertas" value="1" defaultChecked={q.alertas === "1"} className="h-4 w-4 accent-[var(--accent)]" />
          Solo alertas
        </label>
        <button type="submit" className="btn">
          Filtrar
        </button>
        {(filtered || scope !== "security") && (
          <Link href="/seguridad" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
            Limpiar
          </Link>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="eyebrow border-b border-[var(--border)]">
            <tr>
              <th className="px-4 py-3 font-normal">Cuándo</th>
              <th className="px-4 py-3 font-normal">Quién</th>
              <th className="px-4 py-3 font-normal">Qué</th>
              <th className="px-4 py-3 font-normal">Desde dónde</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {events.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[var(--ink-muted)]">
                  {filtered ? "Ningún evento con estos filtros." : "Todavía no hay eventos."}
                </td>
              </tr>
            )}
            {events.rows.map((e) => {
              const detail = describeData(e.action, e.data);
              const device = e.deviceName ?? (e.userAgent ? describeUserAgent(e.userAgent) : null);
              return (
                <tr key={e.id} className={e.severity === "warn" ? "bg-[var(--warn-soft)]" : undefined}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[var(--ink-muted)]">{formatDateTime(e.createdAt, DEFAULT_TIMEZONE)}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{e.actor.name ?? e.actor.email ?? "—"}</span>
                    {e.actor.name && e.actor.email && <span className="block text-xs text-[var(--ink-dim)]">{e.actor.email}</span>}
                    {!e.actor.name && !e.actor.email && <span className="block text-xs text-[var(--ink-dim)]">{e.actor.type === "system" ? "Sistema" : "Sin identificar"}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">
                      {e.severity === "warn" && <span aria-label="Alerta">⚠ </span>}
                      {actionLabel(e.action)}
                    </span>
                    {detail && <span className="block text-xs text-[var(--ink-muted)]">{detail}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--ink-muted)]">
                    {e.ip ? (
                      <Link href={`/seguridad?ip=${encodeURIComponent(e.ip)}`} className="font-mono hover:underline">
                        {e.ip}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {device && <span className="block">{device}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-[var(--ink-muted)]">
        <span>
          {events.total} evento(s) · página {page} de {pages}
        </span>
        <span className="flex gap-4">
          {page > 1 && <Link href={link(page - 1)}>← Anteriores</Link>}
          {page < pages && <Link href={link(page + 1)}>Siguientes →</Link>}
        </span>
      </div>
    </div>
  );
}
