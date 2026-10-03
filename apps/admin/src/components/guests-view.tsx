import Link from "next/link";
import { formatCode, formatDateTime } from "@ticketera/core";
import { getSessionAvailability, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { addGuestsAction, cancelGuestAction, createGuestTypeAction } from "@/lib/actions/guests";
import { TICKET_STATUS } from "@/lib/labels";
import { orderUrl } from "@/lib/qr";

/**
 * Lista de invitados de una función: la usan IMPACTA (/eventos/…/invitados) y el cliente
 * (/cliente/…/invitados). Quien llama ya verificó que el usuario puede ver el evento.
 * Devuelve null si la función no es de ese evento.
 */
export async function GuestsView({
  eventId,
  sessionId,
  q,
  basePath,
  backHref,
}: {
  eventId: string;
  sessionId: string;
  q: string;
  /** Ruta de esta pantalla (para el buscador y la hoja de QRs). */
  basePath: string;
  backHref: string;
}) {
  const session = await prisma.eventSession.findFirst({
    where: { id: sessionId, eventId },
    include: {
      event: true,
      venue: { include: { sections: { where: { seatingMode: "GENERAL_ADMISSION" }, orderBy: { sortOrder: "asc" } } } },
      ticketTypes: { orderBy: { sortOrder: "asc" }, include: { section: true } },
    },
  });
  if (!session) return null;

  const guestList = session.event.mode === "GUEST_LIST";
  // Las invitaciones no eligen butaca: solo tipos generales.
  const guestTypes = session.ticketTypes.filter((t) => t.section?.seatingMode !== "RESERVED");
  const [remaining, tickets, counts] = await Promise.all([
    getSessionAvailability(session.id),
    prisma.ticket.findMany({
      where: {
        sessionId: session.id,
        order: { channel: "GUEST" },
        ...(q
          ? {
              OR: [
                { holderName: { contains: q, mode: "insensitive" } },
                { order: { buyerEmail: { contains: q, mode: "insensitive" } } },
                { order: { buyerDocument: { contains: q } } },
                { code: { contains: q.replace(/[\s-]/g, "").toUpperCase() } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: "asc" }, { holderName: "asc" }],
      take: 500,
      include: { ticketType: { select: { name: true } }, order: { select: { code: true, buyerEmail: true, buyerDocument: true } } },
    }),
    prisma.ticket.groupBy({
      by: ["status"],
      where: { sessionId: session.id, order: { channel: "GUEST" } },
      _count: true,
    }),
  ]);
  const count = (status: string) => counts.find((c) => c.status === status)?._count ?? 0;
  const tz = session.venue.timezone;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={backHref} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
            ← {session.event.title} · {formatDateTime(session.startsAt, tz)}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Invitados</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {guestList
              ? "Evento con lista de invitados: no hay venta. Cada invitado recibe un QR único que se valida en puerta."
              : "Cortesías de un evento con venta: ocupan el cupo del tipo de entrada que elijas."}
          </p>
        </div>
        {count("VALID") + count("USED") > 0 && (
          <Link href={`${basePath}/imprimir`} className="btn">
            Imprimir QRs
          </Link>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Invitaciones válidas", count("VALID") + count("USED")],
          ["Ya ingresaron", count("USED")],
          ["Anuladas", count("CANCELLED")],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="eyebrow">{label}</p>
            <p className="font-mono text-2xl">{value}</p>
          </div>
        ))}
      </div>

      {guestList && (
        <details className="card p-6" open={guestTypes.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">
            {guestTypes.length === 0 ? "1. Crea el tipo de invitación" : "Otro tipo de invitación (ej. Prensa, VIP)"}
          </summary>
          <ActionForm action={createGuestTypeAction} resetOnSuccess className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="sessionId" value={session.id} />
            <label className="label">
              Nombre
              <input name="name" defaultValue="Invitado" required className="field" />
            </label>
            <label className="label">
              Sección (opcional)
              <select name="sectionId" defaultValue="" className="field">
                <option value="">Sin sección</option>
                {session.venue.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (aforo {s.capacity})
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Cupo
              <input name="capacity" type="number" min={1} required placeholder="ej. 300" className="field w-28" />
            </label>
            <button type="submit" className="btn btn-dark">
              Crear
            </button>
            <p className="basis-full text-xs text-[var(--ink-dim)]">
              El cupo es el máximo de invitados de este tipo. Con sección, además comparte el aforo de esa sección y en
              puerta solo entra por las puertas asignadas a ella.
            </p>
          </ActionForm>
        </details>
      )}

      <section className="card p-6">
        <h2 className="eyebrow mb-4">{guestList && guestTypes.length === 0 ? "2. Carga los invitados" : "Cargar invitados"}</h2>
        {guestTypes.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">
            {guestList ? (
              "Primero crea el tipo de invitación."
            ) : (
              <>
                Esta función no tiene entradas generales.{" "}
                <Link href={backHref} className="text-[var(--accent)] underline">
                  Agrega un tipo de entrada
                </Link>{" "}
                para emitir cortesías.
              </>
            )}
          </p>
        ) : (
          <ActionForm
            action={addGuestsAction}
            resetOnSuccess
            successMessage="Invitados cargados: cada uno ya tiene su QR."
            className="flex flex-col gap-4"
          >
            <label className="label">
              Tipo de invitación
              <select name="ticketTypeId" className="field w-fit">
                {guestTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.section ? ` · ${t.section.name}` : ""} — quedan {remaining.get(t.id) ?? 0}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Lista (una persona por línea: nombre, email, documento — email y documento opcionales)
              <textarea
                name="list"
                rows={8}
                placeholder={"Ana Pérez, ana@correo.bo, 1234567\nLuis Rojas\nMarta Quispe; marta@correo.bo"}
                className="field font-mono"
              />
            </label>
            <label className="label">
              O sube un archivo CSV
              <input name="file" type="file" accept=".csv,.txt,text/csv,text/plain" className="text-sm" />
            </label>
            <p className="text-xs text-[var(--ink-dim)]">
              Desde Excel: selecciona las columnas (nombre, email, documento), cópialas y pégalas arriba; o guarda la hoja
              como CSV. Si la primera fila es un encabezado (&ldquo;Nombre&rdquo;), se ignora. Hasta 2.000 por carga.
            </p>
            <button type="submit" className="btn btn-primary w-fit">
              Emitir invitaciones
            </button>
          </ActionForm>
        )}
      </section>

      <section className="card overflow-x-auto">
        <form className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-5 py-3">
          <input name="q" defaultValue={q} placeholder="Buscar por nombre, email, documento o código" className="field min-w-64 flex-1" />
          <button type="submit" className="btn">
            Buscar
          </button>
          {q && (
            <Link href={basePath} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
              Limpiar
            </Link>
          )}
        </form>
        {tickets.length === 0 ? (
          <p className="px-5 py-6 text-sm text-[var(--ink-muted)]">{q ? "Sin resultados." : "Todavía no hay invitados."}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="eyebrow border-b border-[var(--border)]">
              <tr>
                <th className="px-5 py-3 font-normal">Invitado</th>
                <th className="px-5 py-3 font-normal">Tipo</th>
                <th className="px-5 py-3 font-normal">Código</th>
                <th className="px-5 py-3 font-normal">Estado</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {tickets.map((t) => {
                const status = TICKET_STATUS[t.status];
                return (
                  <tr key={t.id}>
                    <td className="px-5 py-2.5">
                      <p className="font-medium">{t.holderName}</p>
                      <p className="text-xs text-[var(--ink-dim)]">
                        {[t.order.buyerEmail, t.order.buyerDocument && `CI ${t.order.buyerDocument}`].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="px-5 py-2.5 text-[var(--ink-muted)]">{t.ticketType.name}</td>
                    <td className="px-5 py-2.5 font-mono text-xs">{formatCode(t.code)}</td>
                    <td className="px-5 py-2.5">
                      <span className={`badge ${status.className}`}>{status.text}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center justify-end gap-3">
                        {t.status !== "CANCELLED" && (
                          <a
                            href={orderUrl(t.order.code)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[var(--accent)] hover:underline"
                          >
                            Ver QR
                          </a>
                        )}
                        {t.status === "VALID" && (
                          <ActionForm action={cancelGuestAction} confirm={`¿Anular la invitación de ${t.holderName}?`}>
                            <input type="hidden" name="ticketId" value={t.id} />
                            <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                              Anular
                            </button>
                          </ActionForm>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {tickets.length === 500 && (
          <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--ink-dim)]">
            Se muestran los primeros 500. Usa el buscador para encontrar a alguien.
          </p>
        )}
      </section>
    </div>
  );
}
