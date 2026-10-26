import { sessionNoun } from "@ticketera/core";

export type EventCheck = { done: boolean; required: boolean; text: string; href: string; action: string };

type ChecklistEvent = {
  id: string;
  mode: string;
  category: string;
  imageUrl: string | null;
  description: string | null;
  minAge: number | null;
  sessions: {
    id: string;
    endsAt: Date | null;
    ticketTypes: unknown[];
    venue: { id: string; name: string; directions: string | null; mapUrl: string | null };
  }[];
};

/**
 * Lo que falta para publicar un evento: lo obligatorio frena el botón de publicar; lo recomendado solo avisa. Cada
 * punto lleva a donde se completa. Lo usan la página del evento y el paso "Revisar" del asistente.
 */
export function eventChecks(event: ChecklistEvent, venueCount: number): EventCheck[] {
  const guestList = event.mode === "GUEST_LIST";
  const noun = sessionNoun(event.category);
  const tab = (name: string) => `/eventos/${event.id}?tab=${name}`;
  const sessionHref = (id: string) => `/eventos/${event.id}/funciones/${id}`;
  const missingPrices = event.sessions.find((s) => s.ticketTypes.length === 0);
  const missingEnd = event.sessions.find((s) => !s.endsAt);
  const missingDirections = event.sessions.map((s) => s.venue).find((v) => !v.directions && !v.mapUrl);
  return [
    { done: venueCount > 0 || event.sessions.length > 0, required: true, text: "Un recinto", href: `/eventos/${event.id}/asistente/lugar`, action: "Elegir o crear" },
    { done: event.sessions.length > 0, required: true, text: `${noun.One} con día y hora`, href: `/eventos/${event.id}/asistente/lugar`, action: `Agregar ${noun.one}` },
    {
      done: event.sessions.length > 0 && !missingPrices,
      required: true,
      text: guestList ? `Invitados en cada ${noun.one}` : `Precios en cada ${noun.one}`,
      href: missingPrices ? `${sessionHref(missingPrices.id)}${guestList ? "/invitados" : ""}` : tab("funciones"),
      action: guestList ? "Cargar invitados" : "Cargar precios",
    },
    ...(guestList
      ? []
      : [
          { done: Boolean(event.imageUrl), required: false, text: "Imagen del evento", href: `${tab("configuracion")}#datos`, action: "Agregar" },
          { done: Boolean(event.description?.trim()), required: false, text: "Descripción", href: `${tab("configuracion")}#datos`, action: "Escribir" },
        ]),
    {
      done: event.sessions.length > 0 && !missingEnd,
      required: false,
      text: `Hora de fin de cada ${noun.one}`,
      href: missingEnd ? `${sessionHref(missingEnd.id)}?tab=horarios` : tab("funciones"),
      action: "Ponerla",
    },
    ...(event.category === "BOLICHE"
      ? [{ done: Boolean(event.minAge), required: false, text: "Edad mínima", href: `${tab("configuracion")}#datos`, action: "Ponerla" }]
      : []),
    ...(missingDirections
      ? [{ done: false, required: false, text: `Cómo llegar a ${missingDirections.name}`, href: `/recintos/${missingDirections.id}`, action: "Completar" }]
      : event.sessions.length > 0
        ? [{ done: true, required: false, text: "Cómo llegar al recinto", href: "#", action: "" }]
        : []),
  ];
}
