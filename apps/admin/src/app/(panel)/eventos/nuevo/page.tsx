import type { Metadata } from "next";
import Link from "next/link";
import { eventLimitMessage, getEventQuota, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { createEventAction } from "@/lib/actions/events";
import { ROLES, requireStaff } from "@/lib/session";
import { EventFields } from "../event-fields";

export const metadata: Metadata = { title: "Nuevo evento" };

export default async function NewEventPage() {
  const staff = await requireStaff(ROLES.manage);
  const clients = await prisma.client.findMany({
    where: { organizationId: staff.organization.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  // IMPACTA no tiene tope; un organizador, el que le fijó IMPACTA.
  const quota = staff.platform ? null : await getEventQuota(staff.organization.id);
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/eventos" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Eventos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nuevo evento</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Se crea como borrador. Después agregas funciones (fecha, hora y recinto) y sus entradas.
        </p>
      </div>
      {quota?.limit != null && (
        <p
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${quota.reached ? "border-[var(--warn)]/40 bg-[var(--warn-soft)] text-[var(--warn)]" : "border-[var(--border)] bg-[var(--surface-2)]"}`}
        >
          {quota.reached ? eventLimitMessage(quota.limit) : `Estás usando ${quota.used} de ${quota.limit} eventos activos (te quedan ${quota.remaining}).`}
        </p>
      )}
      <ActionForm action={createEventAction} className="card flex flex-col gap-5 p-6">
        <EventFields clients={staff.organization.isPlatform ? clients : null} />
        <button type="submit" disabled={quota?.reached} className="btn btn-primary w-fit disabled:cursor-not-allowed disabled:opacity-50">
          Crear evento
        </button>
      </ActionForm>
    </div>
  );
}
