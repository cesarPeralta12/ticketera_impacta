/**
 * Modelos de tipo de entrada: con un clic llenan el formulario con lo típico de cada uno. Son un punto de partida:
 * todo se puede cambiar antes de guardar.
 */
export type TicketModelKey = "general" | "vip" | "mesa" | "free" | "preventa";

export type TicketModel = {
  key: TicketModelKey;
  label: string;
  hint: string;
  name: string;
  /** Precio sugerido (Bs), solo cuando el modelo lo define (la Free es 0). */
  price?: string;
  maxPerOrder: number;
  table?: { peoplePerUnit: number };
  /** Válida para entrar hasta esta hora (la free de un boliche). */
  entryUntil?: string;
  presale?: boolean;
};

export const TICKET_MODELS: TicketModel[] = [
  { key: "general", label: "General", hint: "La entrada común: una persona, hasta 10 por compra.", name: "General", maxPerOrder: 10 },
  { key: "vip", label: "VIP", hint: "Sector o beneficio preferencial; si trae trago, ponle consumo incluido.", name: "VIP", maxPerOrder: 6 },
  {
    key: "mesa",
    label: "Mesa",
    hint: "Para un grupo: el precio es por mesa y cada persona recibe su QR.",
    name: "Mesa",
    maxPerOrder: 2,
    table: { peoplePerUnit: 6 },
  },
  {
    key: "free",
    label: "Free",
    hint: "Gratis, una por persona. Con hora límite de ingreso si es «free hasta la 01:00».",
    name: "Free",
    price: "0",
    maxPerOrder: 1,
    entryUntil: "01:00",
  },
  {
    key: "preventa",
    label: "Preventa",
    hint: "Más barata y por tiempo limitado: al terminar, empieza sola la General de la misma sección.",
    name: "Preventa",
    maxPerOrder: 10,
    presale: true,
  },
];

/** Fin sugerido de una preventa: una semana antes de la función a las 23:59 (hora del recinto), si todavía no pasó. */
export function suggestedPresaleEnd(sessionDate: string, now: Date, startsAt: Date): string | null {
  const weekBefore = new Date(startsAt.getTime() - 7 * 86_400_000);
  if (weekBefore <= now) return null;
  const [year, month, day] = sessionDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! - 7));
  return `${date.toISOString().slice(0, 10)}T23:59`;
}
