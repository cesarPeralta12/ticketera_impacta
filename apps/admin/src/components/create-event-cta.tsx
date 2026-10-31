import Link from "next/link";
import { eventLimitMessage, getEventQuota } from "@ticketera/db";
import { isNightlife, type Staff } from "@/lib/session";

/**
 * La acción principal de la pantalla: "Crear noche" en un boliche, "Nuevo evento" en un organizador. En vez del botón:
 * al dueño de solo lectura, a quién pedir el permiso; al organizador que llegó a su límite de eventos, el aviso (iPass
 * no tiene tope). El servidor vuelve a comprobar todo al crear.
 */
export async function CreateEventCta({ staff, className = "btn btn-primary" }: { staff: Staff; className?: string }) {
  const nightlife = isNightlife(staff);
  if (staff.readOnly) {
    const owner = !staff.platform && (staff.role === "OWNER" || staff.role === "ADMIN");
    return owner ? (
      <p className="max-w-xs rounded-md bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-muted)]">
        Para crear {nightlife ? "noches" : "eventos"}, pide a iPass que te dé <strong>administración propia</strong>.
      </p>
    ) : null;
  }
  const quota = staff.platform ? null : await getEventQuota(staff.organization.id);
  if (quota?.reached && quota.limit !== null) {
    return <p className="max-w-xs rounded-md bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">{eventLimitMessage(quota.limit)}</p>;
  }
  return (
    <Link href="/eventos/nuevo" data-tour="nuevo-evento" className={className}>
      {nightlife ? "+ Crear noche" : "+ Nuevo evento"}
    </Link>
  );
}
