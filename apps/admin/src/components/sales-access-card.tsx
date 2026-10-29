import { DEFAULT_TIMEZONE, formatDateTime } from "@ticketera/core";
import { POS_METHODS, POS_METHOD_LABEL, listSalesAssignments, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { EventSessionsPicker } from "@/components/event-sessions-picker";
import { assignCashierAction, removeSalesAssignmentAction, toggleSalesAssignmentAction, updateSalesSettingsAction } from "@/lib/actions/sales-access";
import { pickerEvents } from "@/lib/picker-events";

/**
 * "Qué puede vender" un cajero: todo lo de la organización o solo lo asignado (eventos completos o funciones sueltas,
 * con vigencia), y con qué medios cobra. Lo controla el servidor en la boletería y en la barra.
 */
export async function SalesAccessCard({ userId, organizationId, bar = false }: { userId: string; organizationId: string; bar?: boolean }) {
  const now = new Date();
  const [membership, assignments, events] = await Promise.all([
    prisma.membership.findFirstOrThrow({ where: { userId, organizationId }, select: { salesScope: true, posMethods: true } }),
    listSalesAssignments(userId, organizationId),
    pickerEvents(organizationId, now),
  ]);
  // La barra siempre trabaja solo con las noches asignadas.
  const assigned = bar || membership.salesScope === "ASSIGNED";
  const methods = membership.posMethods.length === 0 ? [...POS_METHODS] : membership.posMethods;
  const live = (a: (typeof assignments)[number]) => a.active && (!a.startsAt || a.startsAt <= now) && (!a.endsAt || a.endsAt > now);

  return (
    <section className="card space-y-5 p-6">
      <div>
        <h2 className="eyebrow mb-1">{bar ? "Noches que atiende" : "Qué puede vender"}</h2>
        <p className="text-sm text-[var(--ink-muted)]">
          {bar
            ? "En el panel y en la app solo le aparecen (y solo puede leer QR de consumo) las noches asignadas. Si intenta otra, el sistema la rechaza."
            : "En la boletería y en la barra solo le aparecen (y solo puede cobrar) las funciones permitidas. Si intenta otra, el sistema la rechaza."}
        </p>
      </div>

      {!bar && (
      <ActionForm action={updateSalesSettingsAction} className="flex flex-wrap items-end gap-6">
        <input type="hidden" name="userId" value={userId} />
        <fieldset className="label">
          <legend className="mb-1.5">Alcance</legend>
          <div className="flex flex-wrap gap-4 text-sm text-[var(--ink)]">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="salesScope" value="ALL" defaultChecked={!assigned} className="accent-[var(--accent)]" /> Todo lo que está a la venta
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="salesScope" value="ASSIGNED" defaultChecked={assigned} className="accent-[var(--accent)]" /> Solo lo asignado
            </label>
          </div>
        </fieldset>
        <fieldset className="label">
          <legend className="mb-1.5">Medios de cobro</legend>
          <div className="flex flex-wrap gap-4 text-sm text-[var(--ink)]">
            {POS_METHODS.map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="checkbox" name="posMethods" value={m} defaultChecked={methods.includes(m)} className="accent-[var(--accent)]" /> {POS_METHOD_LABEL[m]}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="btn">
          Guardar
        </button>
      </ActionForm>
      )}

      <div className={assigned ? "" : "opacity-60"}>
        <h3 className="mb-2 text-sm font-semibold">
          Eventos y funciones asignados {!assigned && <span className="font-normal text-[var(--ink-dim)]">(ahora vende todo: esto se usa con «Solo lo asignado»)</span>}
        </h3>
        {assignments.length === 0 ? (
          <p className="mb-4 rounded-md bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">
            Sin asignaciones{assigned ? ": en la boletería no le aparece nada para vender." : "."}
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {assignments.map((a) => (
              <li key={a.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${live(a) ? "" : "opacity-60"}`}>
                <span>
                  <span className="block font-medium">{a.event.title}</span>
                  <span className="text-sm text-[var(--ink-muted)]">
                    {a.session ? `${formatDateTime(a.session.startsAt, a.session.venue.timezone)} · ${a.session.venue.name}` : "Todas las funciones"}
                    {(a.startsAt || a.endsAt) &&
                      ` · ${[a.startsAt && `desde ${formatDateTime(a.startsAt, DEFAULT_TIMEZONE)}`, a.endsAt && `hasta ${formatDateTime(a.endsAt, DEFAULT_TIMEZONE)}`].filter(Boolean).join(" ")}`}
                    {!a.active && " · pausada"}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <ActionForm action={toggleSalesAssignmentAction}>
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <button type="submit" className="text-xs text-[var(--accent)] hover:underline">
                      {a.active ? "Pausar" : "Activar"}
                    </button>
                  </ActionForm>
                  <ActionForm action={removeSalesAssignmentAction} confirm="¿Quitar esta asignación?">
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                      Quitar
                    </button>
                  </ActionForm>
                </span>
              </li>
            ))}
          </ul>
        )}

        {events.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">No hay eventos con funciones por delante para asignar.</p>
        ) : (
          <ActionForm action={assignCashierAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-[var(--border)] p-4">
            <input type="hidden" name="userId" value={userId} />
            <EventSessionsPicker events={events} />
            <label className="label">
              Desde (opcional)
              <input type="datetime-local" name="startsAt" className="field" />
            </label>
            <label className="label">
              Hasta (opcional)
              <input type="datetime-local" name="endsAt" className="field" />
            </label>
            <button type="submit" className="btn btn-primary">
              Asignar
            </button>
            <p className="basis-full text-xs text-[var(--ink-dim)]">Si ya tenía ese evento, se reemplaza por lo que marques ahora.</p>
          </ActionForm>
        )}
      </div>
    </section>
  );
}
