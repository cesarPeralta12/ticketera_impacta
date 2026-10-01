import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SECTION_COLORS, type SectionShape } from "@ticketera/core";
import { prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { addAccessPointAction, addGeneralSectionAction, deleteSectionAction } from "@/lib/actions/venues";
import { positioned } from "@/components/seat-map-preview";
import { SEATING_LABEL } from "@/lib/labels";
import { ROLES, requireStaff } from "@/lib/session";
import { SeatDesigner, type DesignerSection } from "./seat-designer";

export const metadata: Metadata = { title: "Recinto" };

type Props = { params: Promise<{ id: string }> };

export default async function VenuePage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const venue = await prisma.venue.findFirst({
    where: { id: (await params).id, organizationId: staff.organization.id },
    include: {
      sections: {
        orderBy: { sortOrder: "asc" },
        include: {
          seats: { select: { x: true, y: true } },
          ticketTypes: { select: { _count: { select: { orderItems: true } } } },
        },
      },
      accessPoints: { orderBy: { name: "asc" } },
    },
  });
  if (!venue) notFound();

  // Con ventas (cualquier orden, incluso vencida) la sección no se puede borrar ni rehacer.
  const sections = venue.sections.map((s) => ({
    ...s,
    sold: s.ticketTypes.some((t) => t._count.orderItems > 0),
    priced: s.ticketTypes.length,
  }));
  const seated: DesignerSection[] = sections
    .filter((s) => s.seatingMode === "RESERVED")
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      layout: (s.layout as SectionShape | null) ?? null,
      seats: positioned(s.seats),
      sold: s.sold,
      priced: s.priced,
    }));

  return (
    <div className="space-y-8">
      <div>
        <Link href="/recintos" className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">
          ← Recintos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{venue.name}</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          {[venue.address, venue.city].filter(Boolean).join(", ")} · {venue.timezone}
        </p>
      </div>

      <section className="card p-6">
        <h2 className="eyebrow mb-4">Secciones</h2>
        {venue.sections.length === 0 ? (
          <p className="mb-4 text-sm text-[var(--ink-muted)]">Todavía no hay secciones.</p>
        ) : (
          <ul className="mb-5 divide-y divide-[var(--border)] text-sm">
            {sections.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 font-medium">{s.name}</span>
                <span className="text-[var(--ink-muted)]">
                  {SEATING_LABEL[s.seatingMode]} · {s.seatingMode === "RESERVED" ? `${s.seats.length} butacas` : `aforo ${s.capacity}`}
                </span>
                {!s.sold ? (
                  <ActionForm
                    action={deleteSectionAction}
                    confirm={`¿Borrar la sección "${s.name}"?${s.priced ? ` También se quitará su precio en ${s.priced} función(es).` : ""}`}
                  >
                    <input type="hidden" name="sectionId" value={s.id} />
                    <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                      Borrar
                    </button>
                  </ActionForm>
                ) : (
                  <span className="eyebrow" title="Tiene entradas vendidas o reservadas">con ventas</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <h3 className="mb-2 text-sm font-medium">Sección de entrada general (sin butacas)</h3>
        <ActionForm action={addGeneralSectionAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="venueId" value={venue.id} />
          <label className="label">
            Nombre
            <input name="name" required placeholder="Cancha, Campo, VIP…" className="field" />
          </label>
          <label className="label">
            Aforo
            <input name="capacity" type="number" min={1} required className="field w-32" />
          </label>
          <label className="label">
            Color
            <select name="color" defaultValue={SECTION_COLORS[0]} className="field">
              {SECTION_COLORS.map((c) => (
                <option key={c} value={c} style={{ color: c }}>
                  ● {c}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-dark">
            Agregar sección
          </button>
        </ActionForm>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Mapa de butacas numeradas</h2>
        <SeatDesigner
          venueId={venue.id}
          existingSections={seated}
        />
      </section>

      <section className="card p-6">
        <h2 className="eyebrow mb-4">Puertas de acceso</h2>
        <p className="mb-3 text-sm text-[var(--ink-muted)]">
          {venue.accessPoints.length ? venue.accessPoints.map((a) => a.name).join(" · ") : "Sin puertas cargadas."}
        </p>
        <ActionForm action={addAccessPointAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="venueId" value={venue.id} />
          <label className="label">
            Nombre
            <input name="name" required placeholder="Puerta 1, Acceso VIP…" className="field" />
          </label>
          <button type="submit" className="btn">
            Agregar puerta
          </button>
        </ActionForm>
      </section>
    </div>
  );
}
