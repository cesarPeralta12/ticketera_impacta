import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { createVenueAction } from "@/lib/actions/venues";
import { ROLES, requireStaff } from "@/lib/session";
import { TIMEZONES } from "@/lib/timezones";

export const metadata: Metadata = { title: "Recintos" };

export default async function VenuesPage() {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const venues = await prisma.venue.findMany({
    where: { organizationId: staff.organization.id },
    orderBy: { name: "asc" },
    include: { sections: { select: { seatingMode: true, capacity: true } }, _count: { select: { sessions: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{venues.length} recinto(s)</p>
        <h1 className="text-2xl font-semibold tracking-tight">Recintos</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Cada recinto tiene sus secciones (generales o con butacas) y sus puertas de acceso. Se diseña una vez y se
          reutiliza en todas sus funciones.
        </p>
      </div>

      <ul className="grid gap-3 md:grid-cols-2">
        {venues.map((v) => {
          const capacity = v.sections.reduce((sum, s) => sum + s.capacity, 0);
          const seated = v.sections.filter((s) => s.seatingMode === "RESERVED").length;
          return (
            <li key={v.id}>
              <Link href={`/recintos/${v.id}`} className="card block p-5 transition-colors hover:border-[var(--accent)]">
                <p className="font-medium">{v.name}</p>
                <p className="text-sm text-[var(--ink-muted)]">{[v.address, v.city].filter(Boolean).join(", ")}</p>
                <p className="eyebrow mt-2">
                  {v.sections.length} secciones{seated ? ` (${seated} numeradas)` : ""} · aforo {capacity} ·{" "}
                  {v._count.sessions} funciones
                </p>
              </Link>
            </li>
          );
        })}
      </ul>

      <section className="card p-6">
        <h2 className="eyebrow mb-4">Nuevo recinto</h2>
        <ActionForm action={createVenueAction} className="flex flex-wrap items-end gap-3">
          <label className="label">
            Nombre
            <input name="name" required className="field" />
          </label>
          <label className="label">
            Dirección
            <input name="address" className="field" />
          </label>
          <label className="label">
            Ciudad
            <input name="city" placeholder="La Paz" className="field" />
          </label>
          <label className="label">
            Zona horaria
            <select name="timezone" defaultValue="America/La_Paz" className="field">
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary">
            Crear recinto
          </button>
        </ActionForm>
      </section>
    </div>
  );
}
