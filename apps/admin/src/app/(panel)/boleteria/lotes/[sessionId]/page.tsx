import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { MAX_PRINT_BATCH, formatDateTime } from "@ticketera/core";
import { canManageWristbands, canRedeemSession, listWristbandBatches, prisma, wristbandTypes } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { createWristbandBatchAction } from "@/lib/actions/wristbands";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Carga de manillas" };

type Props = { params: Promise<{ sessionId: string }> };

export default async function WristbandBatchesPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.pos);
  const session = await prisma.eventSession.findFirst({
    where: { id: (await params).sessionId, cancelledAt: null, event: { organizationId: staff.organization.id } },
    include: { event: { select: { title: true } }, venue: { select: { name: true, timezone: true } } },
  });
  if (!session) notFound();
  const account = { id: staff.id, role: staff.role, organizationId: staff.organization.id };
  const allowed = !staff.readOnly && (await canRedeemSession(account, session.id));
  const manage = allowed && canManageWristbands(account);
  const [batches, types] = allowed ? await Promise.all([listWristbandBatches(account, session.id), manage ? wristbandTypes(session.id) : []]) : [[], []];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/boleteria" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Boletería
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Carga masiva de manillas</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {session.event.title} · {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name}
        </p>
      </div>

      {!allowed ? (
        <p className="card p-5 text-sm text-[var(--ink-muted)]">
          Tu cuenta no puede cargar manillas en esta función. Un administrador puede habilitarlo en Usuarios → tu cuenta → «Tarjetas y manillas
          NFC».
        </p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="eyebrow">Lotes</h2>
            {batches.length === 0 ? (
              <p className="card p-5 text-sm text-[var(--ink-muted)]">
                Todavía no hay lotes.{manage ? " Crea el primero abajo." : " Un administrador tiene que crear uno."}
              </p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {batches.map((b) => (
                  <li key={b.id}>
                    <Link href={`/boleteria/lotes/${session.id}/${b.id}`} className="card block p-5 transition-colors hover:border-[var(--accent)]">
                      <p className="font-medium">{b.name}</p>
                      <p className="text-sm text-[var(--ink-muted)]">
                        {b.ticketType.name} · {b._count.items}
                        {b.expected && b.status === "OPEN" ? ` de ${b.expected}` : ""} manillas · {b.createdBy.name}
                      </p>
                      <span
                        className={`badge mt-2 ${b.status === "OPEN" ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--success-soft)] text-[var(--success)]"}`}
                      >
                        {b.status === "OPEN" ? "Abierto: falta confirmar" : `Confirmado · serie ${b.printBatch?.prefix ?? ""}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {manage && (
            <section className="card space-y-4 p-6">
              <div>
                <h2 className="eyebrow mb-1">Nuevo lote</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  Para manillas nuevas: al confirmar el lote se crea una entrada por cada una, numerada y vinculada. Ocupan cupo del tipo.
                </p>
              </div>
              {types.length === 0 ? (
                <p className="rounded-md bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">
                  Esta función no tiene tipos de entrada para manillas: necesitan NFC activado y ser entradas generales (sin butaca, mesa ni QR
                  dinámico).
                </p>
              ) : (
                <ActionForm action={createWristbandBatchAction} className="flex flex-wrap items-end gap-4">
                  <input type="hidden" name="sessionId" value={session.id} />
                  <label className="label">
                    Nombre del lote
                    <input name="name" required maxLength={80} placeholder="VIP rojas" className="field" />
                  </label>
                  <label className="label">
                    Tipo de entrada
                    <select name="ticketTypeId" required className="field">
                      {types.map((t) => (
                        <option key={t.id} value={t.id} disabled={t.available === 0}>
                          {t.name} (quedan {t.available})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Cantidad esperada (opcional)
                    <input name="expected" type="number" min={1} max={MAX_PRINT_BATCH} className="field w-40" />
                  </label>
                  <label className="label">
                    Prefijo (opcional)
                    <input name="prefix" maxLength={4} placeholder="VIP" className="field w-28 uppercase" />
                  </label>
                  <fieldset className="label basis-full">
                    <legend className="mb-1.5">¿Cuándo abren la puerta?</legend>
                    <div className="flex flex-wrap gap-4 text-sm text-[var(--ink)]">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name="mode" value="VALID_ON_PRINT" defaultChecked className="accent-[var(--accent)]" /> Apenas se confirma el
                        lote
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name="mode" value="ACTIVATE_ON_SALE" className="accent-[var(--accent)]" /> Recién al marcarlas vendidas
                      </label>
                    </div>
                  </fieldset>
                  <button type="submit" className="btn btn-primary">
                    Crear y empezar a leer
                  </button>
                </ActionForm>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
