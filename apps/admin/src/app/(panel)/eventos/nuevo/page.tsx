import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@ticketera/db";
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
      <ActionForm action={createEventAction} className="card flex flex-col gap-5 p-6">
        <EventFields clients={clients} />
        <button type="submit" className="btn btn-primary w-fit">
          Crear evento
        </button>
      </ActionForm>
    </div>
  );
}
