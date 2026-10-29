import { prisma } from "@ticketera/db";
import { thumbnailOf, type ThumbnailData } from "@/components/venue-thumbnail";

/** Un recinto para elegir al crear una función: su miniatura y un resumen para reconocerlo. */
export type VenueChoice = { id: string; name: string; city: string | null; timezone: string; detail: string; thumb: ThumbnailData };

/** Butacas por miniatura en el selector (con muchos recintos, se dibuja una de cada tantas). */
const THUMB_SEATS = 400;

/** Los recintos del organizador, por nombre, para el selector de recinto. */
export async function venueChoices(organizationId: string): Promise<VenueChoice[]> {
  const venues = await prisma.venue.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      city: true,
      timezone: true,
      mapItems: true,
      sections: { select: { seatingMode: true, capacity: true, color: true, layout: true, seats: { select: { x: true, y: true } } } },
      _count: { select: { sessions: true } },
    },
  });
  return venues.map((v) => {
    const capacity = v.sections.reduce((sum, s) => sum + s.capacity, 0);
    const seated = v.sections.filter((s) => s.seatingMode === "RESERVED").length;
    const parts = [
      `${v.sections.length} ${v.sections.length === 1 ? "sección" : "secciones"}${seated ? ` (${seated} numerada${seated === 1 ? "" : "s"})` : ""}`,
      `aforo ${capacity.toLocaleString("es-BO")}`,
      v._count.sessions ? `${v._count.sessions} ${v._count.sessions === 1 ? "función" : "funciones"}` : "sin funciones todavía",
    ];
    return { id: v.id, name: v.name, city: v.city, timezone: v.timezone, detail: parts.join(" · "), thumb: thumbnailOf(v, THUMB_SEATS) };
  });
}
