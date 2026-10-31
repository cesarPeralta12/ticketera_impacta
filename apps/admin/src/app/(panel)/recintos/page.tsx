import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { TABLE_RADIUS, VENUE_TEMPLATES, templateCapacity, templateSectionSeats } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { FilterForm } from "@/components/filter-form";
import { VenueThumbnail, thumbnailOf, type ThumbnailData } from "@/components/venue-thumbnail";
import { createVenueAction, createVenueFromTemplateAction } from "@/lib/actions/venues";
import { ROLES, requireStaff } from "@/lib/session";
import { TIMEZONES } from "@/lib/timezones";

export const metadata: Metadata = { title: "Recintos" };

/** Miniatura de una plantilla. */
function templateThumbnail(template: (typeof VENUE_TEMPLATES)[number]): ThumbnailData {
  return {
    items: template.items,
    zones: template.sections.flatMap((s) => (s.kind === "zone" ? [{ zone: s.zone, color: s.color }] : [])),
    seats: template.sections.flatMap((s) =>
      templateSectionSeats(s).map((p) => ({ x: p.x, y: p.y, color: s.color, r: s.kind === "lounges" ? TABLE_RADIUS : s.kind === "seated" ? 5 : undefined })),
    ),
  };
}

/** Biblioteca de recintos (con su miniatura y los eventos que los usan) y recintos nuevos, en blanco o desde una plantilla. */
export default async function VenuesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const q = ((await searchParams).q ?? "").trim();
  const venues = await prisma.venue.findMany({
    where: {
      organizationId: staff.organization.id,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { address: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { name: "asc" },
    include: {
      sections: { select: { seatingMode: true, capacity: true, color: true, layout: true, seats: { select: { x: true, y: true } } } },
      sessions: { select: { event: { select: { id: true, title: true, status: true } } }, orderBy: { startsAt: "desc" } },
      _count: { select: { sessions: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{venues.length} recinto(s)</p>
        <h1 className="text-2xl font-semibold tracking-tight">Recintos</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Cada recinto tiene sus secciones (generales o con butacas) y sus puertas de acceso. Se diseña una vez y se
          reutiliza en todas sus funciones. Para no empezar de cero, créalo desde una plantilla.
        </p>
      </div>

      <FilterForm>
        <label className="label grow basis-64">
          Buscar
          <input type="search" name="q" defaultValue={q} placeholder="Nombre, ciudad o dirección del recinto" className="field" autoComplete="off" />
        </label>
      </FilterForm>

      {venues.length === 0 && q && <p className="card p-6 text-center text-[var(--ink-muted)]">Ningún recinto coincide con la búsqueda.</p>}

      {venues.length === 0 && !q && (
        <div className="card border-dashed p-8 text-center">
          <p className="font-medium">Todavía no hay recintos.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--ink-muted)]">
            Un recinto es el lugar: su nombre, dirección y el mapa de secciones (pista, plateas, VIP, mesas). Créalo desde una
            plantilla o en blanco, abajo.
          </p>
        </div>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {venues.map((v) => {
          const capacity = v.sections.reduce((sum, s) => sum + s.capacity, 0);
          const seated = v.sections.filter((s) => s.seatingMode === "RESERVED").length;
          const events = [...new Map(v.sessions.map((s) => [s.event.id, s.event])).values()];
          const thumb = thumbnailOf(v);
          return (
            <li key={v.id}>
              <Link href={`/recintos/${v.id}`} className="card block space-y-3 p-4 transition-colors hover:border-[var(--accent)]">
                <VenueThumbnail data={thumb} />
                <div>
                  <p className="font-medium">{v.name}</p>
                  <p className="text-sm text-[var(--ink-muted)]">{[v.address, v.city].filter(Boolean).join(", ") || "Sin dirección"}</p>
                  <p className="eyebrow mt-2">
                    {v.sections.length} secciones{seated ? ` (${seated} numeradas)` : ""} · aforo {capacity} · {v._count.sessions} funciones
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {events.length === 0
                      ? "Todavía ningún evento lo usa."
                      : `Lo usan: ${events
                          .slice(0, 3)
                          .map((e) => e.title)
                          .join(", ")}${events.length > 3 ? ` y ${events.length - 3} más` : ""}`}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {!staff.readOnly && (
        <>
          <section data-tour="plantillas" className="card space-y-4 p-6">
            <div>
              <h2 className="eyebrow">Nuevo recinto desde una plantilla</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Trae el mapa armado (secciones, zonas, mesas, escenario, barras) y las puertas. Después se cambia lo que haga
                falta: nombres, aforos, mover cosas.
              </p>
            </div>
            <ActionForm action={createVenueFromTemplateAction} className="space-y-4">
              <fieldset className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <legend className="sr-only">Plantilla</legend>
                {VENUE_TEMPLATES.map((t, i) => (
                  <label key={t.key} className="card flex cursor-pointer flex-col gap-2 p-3 has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
                    <VenueThumbnail data={templateThumbnail(t)} />
                    <span className="flex items-center gap-2 font-medium">
                      <input type="radio" name="template" value={t.key} defaultChecked={i === 0} />
                      {t.label}
                    </span>
                    <span className="text-xs text-[var(--ink-muted)]">{t.description}</span>
                    <span className="text-xs text-[var(--ink-dim)]">Aforo {templateCapacity(t).toLocaleString("es-BO")}</span>
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap items-end gap-3">
                <label className="label">
                  Nombre
                  <input name="name" required maxLength={120} placeholder="ej. Salón Los Tajibos" className="field" />
                </label>
                <label className="label">
                  Dirección
                  <input name="address" maxLength={200} className="field" />
                </label>
                <label className="label">
                  Ciudad
                  <input name="city" maxLength={80} placeholder="Santa Cruz" className="field" />
                </label>
                <button type="submit" className="btn btn-primary">
                  Crear desde la plantilla
                </button>
              </div>
            </ActionForm>
          </section>

          <section className="card p-6">
            <h2 className="eyebrow mb-4">Nuevo recinto en blanco</h2>
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
        </>
      )}
    </div>
  );
}
