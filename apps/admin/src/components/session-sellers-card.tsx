import Link from "next/link";
import { DEFAULT_TIMEZONE, formatDateTime } from "@ticketera/core";
import { prisma, sessionSellers } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { Help } from "@/components/help";
import { addSessionSellerAction, removeSalesAssignmentAction } from "@/lib/actions/sales-access";

/**
 * "Quién puede vender" esta función: los cajeros que venden todo, y los cajeros y promotores que la tienen asignada
 * (esta función o el evento completo). Desde aquí se suma un cajero a esta función.
 */
export async function SessionSellersCard({ session, organizationId, canEdit }: { session: { id: string; eventId: string }; organizationId: string; canEdit: boolean }) {
  const now = new Date();
  const [sellers, candidates] = await Promise.all([
    sessionSellers(session, organizationId),
    prisma.membership.findMany({
      where: { organizationId, role: "CASHIER", salesScope: "ASSIGNED", user: { active: true } },
      orderBy: { user: { name: "asc" } },
      select: { user: { select: { id: true, name: true } } },
    }),
  ]);
  const assignedIds = new Set(sellers.assigned.map((a) => a.userId));
  const addable = candidates.filter((c) => !assignedIds.has(c.user.id));

  return (
    <section className="card space-y-4 p-6 lg:col-span-2">
      <h2 className="eyebrow flex items-center gap-2">
        Quién puede vender
        <Help title="Quién puede vender">
          Los cajeros que venden «todo» venden todas las funciones. Los cajeros con «solo lo asignado» y los promotores venden solo lo que se les
          asigna, aquí o en la ficha de cada cuenta (Usuarios). El servidor rechaza cualquier venta de una función no asignada.
        </Help>
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-sm font-semibold">Cajeros que venden todo</p>
          {sellers.allScope.length === 0 ? (
            <p className="text-sm text-[var(--ink-dim)]">Ninguno.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {sellers.allScope.map((u) => (
                <li key={u.id}>{u.name}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-semibold">Asignados a esta función</p>
          {sellers.assigned.length === 0 ? (
            <p className="text-sm text-[var(--ink-dim)]">Ninguno.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] text-sm">
              {sellers.assigned.map((a) => {
                const live = a.active && (!a.startsAt || a.startsAt <= now) && (!a.endsAt || a.endsAt > now);
                return (
                  <li key={a.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${live && a.user.active ? "" : "opacity-60"}`}>
                    <span>
                      <span className="font-medium">{a.user.name}</span>
                      <span className="block text-xs text-[var(--ink-dim)]">
                        {a.role === "PROMOTER" ? "Promotor" : "Cajero"} · {a.sessionId ? "esta función" : "todo el evento"}
                        {a.endsAt && ` · hasta ${formatDateTime(a.endsAt, DEFAULT_TIMEZONE)}`}
                        {!a.active && " · pausada"}
                        {!a.user.active && " · cuenta desactivada"}
                      </span>
                    </span>
                    {canEdit &&
                      (a.role === "PROMOTER" ? (
                        <Link href={`/promotores/${a.userId}`} className="text-xs text-[var(--accent)] hover:underline">
                          Ver en Promotores
                        </Link>
                      ) : (
                        <ActionForm action={removeSalesAssignmentAction} confirm={a.sessionId ? "¿Quitarle esta función?" : "Tiene asignado todo el evento: ¿quitarle el evento completo?"}>
                          <input type="hidden" name="assignmentId" value={a.id} />
                          <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                            {a.sessionId ? "Quitar" : "Quitar (todo el evento)"}
                          </button>
                        </ActionForm>
                      ))}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {canEdit && addable.length > 0 && (
        <ActionForm action={addSessionSellerAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="sessionId" value={session.id} />
          <label className="label">
            Sumar un cajero (de los que venden solo lo asignado)
            <select name="userId" className="field min-w-56">
              {addable.map((c) => (
                <option key={c.user.id} value={c.user.id}>
                  {c.user.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn">
            Puede vender esta función
          </button>
        </ActionForm>
      )}
    </section>
  );
}
